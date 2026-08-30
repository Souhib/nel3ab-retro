//! Ce qu'une requête veut, lu sur ses premiers octets.
//!
//! Un seul port sert la page, l'image, le son et les manettes, parce que le
//! proxy Tailscale n'en relaie qu'un. Tout ce qui arrive passe donc par ici, et
//! ce module ne fait que RECONNAÎTRE: il ne sert rien, n'ouvre rien, et n'a
//! aucun état. C'est ce qui permet de le tester par une table de requêtes
//! écrites à la main, sans une socket.

use std::net::TcpStream;

use nel3ab_protocol::PlayerSlot;

use super::CLASSIFY_TIMEOUT;
use super::page::Packing;

/// The port named by `take=N` in a request line, if any is.
pub(super) fn take_from(request: &str) -> Option<PlayerSlot> {
    let rest = request.split("take=").nth(1)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    PlayerSlot::new(digits.parse().ok()?).ok()
}

/// What a connection turned out to be.
pub(super) enum Route {
    /// Les dernières secondes, emballées et rendues telles quelles.
    Clip,
    /// One game's picture, asked for by its position in the library.
    ///
    /// By position and never by name, for the reason the library itself gives:
    /// a position can only ever select something this worker found, so no
    /// spelling of a path can reach a file it did not offer.
    Art(usize),
    /// La vidéo, et LEQUEL des deux flux.
    ///
    /// `/video` donne la pleine taille, `/video?half=1` le demi-format. Un
    /// paramètre et pas un second chemin, pour la même raison que `?take=` sur
    /// la manette: le souhait voyage avec la demande plutôt que d'être deviné.
    Video {
        /// Vrai pour le flux réduit.
        half: bool,
    },
    Sound,
    Input {
        take: Option<PlayerSlot>,
    },
    /// The room's library, as JSON. A plain `GET`, because listing what is
    /// there changes nothing — and because a page that can be fetched can be
    /// looked at with `curl` when it misbehaves.
    Roms,
    Page {
        /// La compression que ce client a dite accepter.
        packing: Packing,
    },
}

/// Whether a handshake came from a page this server itself served.
///
/// A `WebSocket` is NOT subject to the same-origin policy: any page in any tab
/// can open one to any host the browser can reach, and read what comes back.
/// Measured on this machine before the check existed — a raw handshake declaring
/// `Origin: https://un-site-quelconque.example` was answered `101 Switching
/// Protocols` and handed 32 KiB of live video.
///
/// That matters more here than the missing authentication it resembles, because
/// it defeats the one thing that WAS protecting the room. The tailnet stops a
/// stranger connecting; it does not stop a stranger's PAGE using the browser of
/// somebody who is already on it.
///
/// The rule compares `Origin` against `Host` rather than an allow-list, so it
/// configures itself: the page is served by this same server, so its origin is
/// whatever host it was fetched from. Through the Tailscale proxy that is
/// `salle.exemple.ts.net:8443` on both headers; locally it is `localhost:8100`
/// on both. An allow-list would be one more place to update when the address
/// changes, and the failure mode of forgetting is a room nobody can join.
///
/// **An absent `Origin` is allowed, and that is deliberate.** A browser always
/// sends one; a native client — the benchmark harness, a test script — sends
/// none. Rejecting those would close the harness without closing anything a
/// browser can do. What actually bounds the non-browser case is the listening
/// address: bound to loopback, the only things that can reach it are local
/// processes and the proxy.
pub(super) fn same_origin(head: &str) -> bool {
    let field = |name: &str| {
        head.lines()
            .find_map(|line| line.strip_prefix(name))
            .map(|value| value.trim().to_owned())
    };
    let Some(origin) = field("origin:") else {
        return true;
    };
    // `null` is what a sandboxed iframe sends. It is not this server.
    let Some(host) = field("host:") else {
        return false;
    };
    // Scheme off, and nothing else: `Origin` carries no path by definition, so
    // what is left is exactly the authority to compare.
    origin
        .split_once("://")
        .is_some_and(|(_, authority)| authority == host)
}

/// Reads the request head **without consuming it**, so tungstenite can do the
/// handshake itself afterwards.
pub(super) fn classify(stream: &TcpStream) -> Option<Route> {
    let mut head = [0_u8; 1024];
    // A short peek is enough: the request line and the Upgrade header are both
    // in the first kilobyte of anything a browser sends.
    //
    // NAMED, because it does not stay here: the deadline is set on the SOCKET,
    // so every route inherits it and has to say what it wants instead.
    if stream.set_read_timeout(Some(CLASSIFY_TIMEOUT)).is_err() {
        return None;
    }
    let read = stream.peek(&mut head).ok()?;
    let text = String::from_utf8_lossy(&head[..read]).to_lowercase();
    if !text.contains("upgrade: websocket") {
        // Before the catch-all, or both would be served the HTML page.
        if text.starts_with("get /roms") {
            return Some(Route::Roms);
        }
        // Le clip: la seule route qui CHANGE quelque chose sans être une
        // poignée de main. L'origine est donc vérifiée ici aussi, et pas
        // seulement sur les montées en grade.
        //
        // Sans ça, une page que quelqu'un visiterait ailleurs pourrait faire
        // écrire un clip par son navigateur. Elle ne pourrait pas le LIRE, le
        // navigateur refusant la réponse, mais l'effet aurait lieu quand même,
        // et l'effet est une trentaine de secondes de la partie de quelqu'un
        // d'autre. C'est la parade habituelle, et elle coûte une ligne.
        if text.starts_with("post /clip") {
            if !same_origin(&text) {
                tracing::warn!("une demande de clip est venue d'ailleurs, refusée");
                return None;
            }
            return Some(Route::Clip);
        }
        let packing = Packing::wanted(&text);
        return Some(art_from(&text).map_or(Route::Page { packing }, Route::Art));
    }
    // Checked once, here, rather than in each of the three socket routes: a
    // check that has to be repeated is a check somebody adds a fourth route
    // without. The page itself is not covered because reading it cross-origin
    // gains nothing — it is the same bytes anybody can fetch.
    if !same_origin(&text) {
        tracing::warn!("a websocket handshake came from another origin, refusing it");
        return None;
    }
    if text.starts_with("get /video") {
        return Some(Route::Video {
            half: text.contains("half=1"),
        });
    }
    if text.starts_with("get /sound") {
        return Some(Route::Sound);
    }
    if text.starts_with("get /input") {
        // `/input?take=3` asks for THAT port, occupied or not. Only a person can
        // send it — the page has four sockets drawn on it and this is what
        // clicking one does — so the wish travels with the request rather than
        // being guessed at from the state of the room.
        return Some(Route::Input {
            take: take_from(&text),
        });
    }
    None
}

/// Reads `/art/<n>.png` out of a request line.
///
/// Strict on purpose. Anything that is not exactly a number between `/art/` and
/// `.png` falls through to the page, which is what every other unknown path
/// does: a route that accepted `/art/x.png` would have to decide what to do with
/// it, and there is nothing right to decide.
pub(super) fn art_from(text: &str) -> Option<usize> {
    text.strip_prefix("get /art/")?
        .split_whitespace()
        .next()?
        .strip_suffix(".png")?
        .parse()
        .ok()
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::time::Duration;

    use super::*;

    /// Routing is decided by peeking, so the bytes must still be there for the
    /// handshake afterwards. Checked by reading them after classifying.
    #[test]
    fn classifying_a_request_does_not_consume_it() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let request = b"GET /video HTTP/1.1\r\nUpgrade: websocket\r\n\r\n";

        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(request).unwrap();
            stream.flush().unwrap();
            // Held open so the server side does not see EOF mid-test.
            std::thread::sleep(Duration::from_millis(200));
        });

        let (stream, _) = listener.accept().unwrap();
        assert!(matches!(
            classify(&stream),
            Some(Route::Video { half: false })
        ));

        let mut seen = vec![0_u8; request.len()];
        let mut stream = stream;
        stream.read_exact(&mut seen).unwrap();
        assert_eq!(seen, request, "the peek consumed the request");
        client.join().unwrap();
    }

    #[test]
    fn a_plain_request_is_a_page_and_an_unknown_upgrade_is_neither() {
        for (request, expected) in [
            (&b"GET / HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (
                &b"GET /input HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "input",
            ),
            (
                &b"GET /nope HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "none",
            ),
            (
                &b"GET /video HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
            (
                &b"GET /video?half=1 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video-half",
            ),
            // Les jumeaux négatifs. Chacun donnerait le demi-format si la
            // lecture était approximative, et aucun ne le demande.
            (
                &b"GET /video?half=0 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
            (
                &b"GET /video?other=1 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
        ] {
            assert_eq!(
                seen(request),
                expected,
                "for {}",
                String::from_utf8_lossy(request)
            );
        }
    }

    /// Ce que `classify` fait d'une requête, en un mot.
    ///
    /// Par une VRAIE socket, parce que `classify` regarde sans consommer et que
    /// c'est justement ce qu'on veut vérifier. Le client dort deux cents
    /// millisecondes avant de partir: sans ça, la socket peut être fermée avant
    /// que le serveur ait regardé, et le test devient capricieux.
    fn seen(request: &[u8]) -> &'static str {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let owned = request.to_vec();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(&owned).unwrap();
            stream.flush().unwrap();
            std::thread::sleep(Duration::from_millis(200));
        });
        let (stream, _) = listener.accept().unwrap();
        let got = match classify(&stream) {
            Some(Route::Page { .. }) => "page",
            Some(Route::Video { half }) => {
                if half {
                    "video-half"
                } else {
                    "video"
                }
            }
            Some(Route::Sound) => "sound",
            Some(Route::Input { .. }) => "input",
            Some(Route::Roms) => "roms",
            Some(Route::Art(_)) => "art",
            Some(Route::Clip) => "clip",
            None => "none",
        };
        client.join().unwrap();
        got
    }

    /// The positive case, and its negative twins.
    ///
    /// Red-first: delete the `same_origin` call in `classify` and the foreign
    /// and sandboxed cases below both pass, which is what the server did before
    /// this existed.
    #[test]
    fn a_handshake_is_taken_only_from_a_page_this_server_served() {
        // Through the Tailscale proxy: both headers carry the proxy's authority.
        assert!(same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://salle.exemple.ts.net:8443"
        ));
        // Sur le port par défaut, où le port disparaît des DEUX en-têtes. C'est
        // le cas de la salle depuis le 30 août 2026, et rien ne le tenait: une
        // comparaison qui aurait ajouté un port d'un seul côté aurait refusé
        // toutes les poignées de main de la salle réelle.
        assert!(same_origin(
            "host: salle.exemple.ts.net\r\norigin: https://salle.exemple.ts.net"
        ));
        // Et son jumeau: le port par défaut d'un côté seulement n'est pas la
        // même origine, parce qu'on compare des chaînes et pas des URL.
        assert!(!same_origin(
            "host: salle.exemple.ts.net\r\norigin: https://salle.exemple.ts.net:8443"
        ));
        // Locally, over plain http.
        assert!(same_origin(
            "host: localhost:8100\r\norigin: http://localhost:8100"
        ));
        // No origin at all: a native client, not a page. Allowed on purpose —
        // see the note on `same_origin`.
        assert!(same_origin("host: localhost:8100"));

        // The attack this exists for.
        assert!(!same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://un-site-quelconque.example"
        ));
        // A sandboxed iframe. It is not this server, so it is not us.
        assert!(!same_origin("host: localhost:8100\r\norigin: null"));
        // The same name on another port is another origin, and the browser
        // agrees: a page on :9000 must not drive the room on :8100.
        assert!(!same_origin(
            "host: localhost:8100\r\norigin: http://localhost:9000"
        ));
        // A host that merely ENDS with ours. Matching by suffix would take this.
        assert!(!same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://evil-salle.exemple.ts.net:8443"
        ));
    }

    /// And that the check is WIRED IN, not merely present.
    ///
    /// The test above proves `same_origin` decides correctly; it would go on
    /// passing if nobody called it. This one drives `classify` itself, so
    /// deleting the call from the routing turns it red.
    #[test]
    fn a_foreign_origin_gets_no_route_at_all() {
        for (request, routed) in [
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nUpgrade: websocket\r\n\r\n"[..],
                true,
            ),
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: http://localhost:8100\r\nUpgrade: websocket\r\n\r\n"[..],
                true,
            ),
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: https://un-site-quelconque.example\r\nUpgrade: websocket\r\n\r\n"[..],
                false,
            ),
            (
                &b"GET /input?take=1 HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: https://un-site-quelconque.example\r\nUpgrade: websocket\r\n\r\n"[..],
                false,
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let owned = request.to_vec();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                stream.write_all(&owned).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(200));
            });
            let (stream, _) = listener.accept().unwrap();
            assert_eq!(
                classify(&stream).is_some(),
                routed,
                "for {}",
                String::from_utf8_lossy(request)
            );
            client.join().unwrap();
        }
    }

    /// The library is its own route, and it is NOT the page.
    ///
    /// Red-first: move the `/roms` test after the catch-all in `classify` and
    /// this returns `Page` — which is how a browser asking for the game list
    /// would quietly receive an HTML document and parse nothing out of it.
    #[test]
    fn asking_for_the_library_is_not_asking_for_the_page() {
        for (request, expected) in [
            (&b"GET /roms HTTP/1.1\r\nHost: x\r\n\r\n"[..], "roms"),
            (&b"GET / HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            // No prefix match on anything shorter: `/rom` is not `/roms`.
            (&b"GET /rom HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/0.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "art0"),
            (&b"GET /art/12.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "art12"),
            // The negative twins. Each of these would be a picture if the
            // parsing were loose, and none of them names one.
            (&b"GET /art/x.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/3 HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/-1.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (
                &b"GET /art/../roms.png HTTP/1.1\r\nHost: x\r\n\r\n"[..],
                "page",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let owned = request.to_vec();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                stream.write_all(&owned).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(200));
            });
            let (stream, _) = listener.accept().unwrap();
            let got = match classify(&stream) {
                Some(Route::Roms) => "roms".to_owned(),
                Some(Route::Art(index)) => format!("art{index}"),
                Some(Route::Page { .. }) => "page".to_owned(),
                _ => "other".to_owned(),
            };
            assert_eq!(got, expected, "for {}", String::from_utf8_lossy(request));
            client.join().unwrap();
        }
    }

    /// Le clip est la seule route qui CHANGE quelque chose sans être une
    /// poignée de main, donc la seule requête ordinaire dont l'origine compte.
    #[test]
    fn a_clip_is_taken_only_from_a_page_this_server_served() {
        let mine = concat!(
            "POST /clip HTTP/1.1\r\n",
            "Host: salle.exemple.ts.net:8443\r\n",
            "Origin: https://salle.exemple.ts.net:8443\r\n\r\n"
        );
        let elsewhere = concat!(
            "POST /clip HTTP/1.1\r\n",
            "Host: salle.exemple.ts.net:8443\r\n",
            "Origin: https://un-site-quelconque.example\r\n\r\n"
        );

        assert_eq!(seen(mine.as_bytes()), "clip");
        assert_eq!(seen(elsewhere.as_bytes()), "none");
    }

    /// Le jumeau du chemin: `/clips` ou `/clipboard` ne sont pas `/clip`, et une
    /// requête ordinaire vers le même chemin non plus.
    #[test]
    fn only_a_post_to_that_exact_path_asks_for_a_clip() {
        let head = |line: &str| {
            format!(
                "{line} HTTP/1.1\r\nHost: salle.exemple.ts.net:8443\r\n\
                 Origin: https://salle.exemple.ts.net:8443\r\n\r\n"
            )
        };

        assert_eq!(seen(head("GET /clip").as_bytes()), "page");
        assert_eq!(seen(head("POST /clipboard").as_bytes()), "clip");
    }
}
