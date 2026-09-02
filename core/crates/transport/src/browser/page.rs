//! La page, et ce qui l'accompagne sur le fil.
//!
//! Un fichier unique, sans ressource externe, construit ailleurs et compilé
//! dans le binaire. Trois choses en découlent et vivent ici: la compression,
//! qui ne se fait qu'une fois puisque les octets ne changent jamais; la
//! politique de sécurité, qui peut nommer le script par son empreinte pour la
//! même raison; et la revalidation, qui rend une visite suivante gratuite.

use std::io::{Read as _, Write as _};
use std::net::TcpStream;

use super::HARDENING;

/// Sends bytes that are not text.
///
/// Cached for five minutes, unlike everything else here, and the number has a
/// reason on each side. Without any cache the browser refetches eight pictures
/// every time the menu opens, and each one flashes as it arrives. Cached for
/// ever, a game dropped into the folder would show the previous occupant of its
/// position until somebody emptied the cache by hand.
pub(super) fn serve_bytes(mut stream: TcpStream, body: &[u8], content_type: &str) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\nCache-Control: max-age=300\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Says no, for a picture this room does not have.
///
/// A real 404 rather than the page, so an `<img>` fails cleanly and the menu
/// draws its fallback. Served the HTML instead, the browser would report a
/// broken image only after decoding a page.
pub(super) fn serve_missing(mut stream: TcpStream) {
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream
        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.flush();
}

/// Dit « pas encore », pour une question dont la réponse n'existe pas d'abord.
///
/// La taille de l'image n'est connue qu'une fois l'émulateur démarré. Répondre
/// une valeur par défaut avant ça serait répondre faux la moitié du temps, et
/// une page qui agit sur cette réponse en garderait la conséquence.
pub(super) fn serve_unready(mut stream: TcpStream) {
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream.write_all(
        b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\
          Cache-Control: no-store\r\nConnection: close\r\n\r\n",
    );
    let _ = stream.flush();
}

/// La page servie: compressée quand le client sait la lire, et étiquetée.
///
/// # Ce que ça change, mesuré
///
/// 424 Kio non compressée contre 128 en gzip. C'est exactement la personne dont
/// la liaison va mal qui paie ces trois cent kilo-octets, et c'est celle qu'on
/// passe son temps à essayer d'aider.
///
/// La compression se fait UNE fois, au premier appel, et pas à chaque requête:
/// la page ne change pas pendant qu'un worker tourne, puisqu'elle est compilée
/// dans le binaire.
///
/// L'étiquette remplace un `Cache-Control: no-store` qui faisait retélécharger
/// la page entière à chaque visite. Avec `no-cache` et un `ETag`, le navigateur
/// redemande mais reçoit une réponse vide quand rien n'a changé.
/// Ce qu'on dit au navigateur en plus du contenu.
///
/// Le risque est faible et il faut le dire: le service n'écoute que sur la
/// boucle locale, le proxy est la seule porte, et la socket vérifie déjà
/// l'origine, ce qui est la protection qui compte. Ces trois lignes ne
/// remplacent rien; elles ferment ce qui reste ouvert pour rien.
///
/// Ce que `script-src` autorise: rien, sauf exactement les scripts de CETTE
/// page.
///
/// # Pourquoi une empreinte plutôt que `'unsafe-inline'`
///
/// L'en-tête portait `script-src 'self' 'unsafe-inline'`, ce qui autorise
/// n'importe quel script en ligne et retire à la règle presque tout son intérêt
/// contre l'injection. C'était la conséquence de la page en un seul fichier, et
/// ce choix reste bon.
///
/// Sauf que le contenu est FIGÉ: la page est un artefact construit puis compilé
/// dans le binaire. Son script ne changera pas d'ici le prochain démarrage, donc
/// le nommer par son empreinte transforme une règle de façade en règle réelle,
/// sans rien changer à l'architecture.
///
/// # Pourquoi calculée ici, et pas écrite à côté
///
/// Une empreinte gardée dans un fichier serait une deuxième copie à tenir
/// d'accord avec la première, et ce dépôt a déjà payé plusieurs fois pour ce
/// genre de paire. Calculée sur la page qu'on sert vraiment, elle ne peut pas
/// diverger de ce qui part sur le fil: si elle était fausse, la page ne
/// s'exécuterait pas du tout, ce qui se voit tout de suite.
///
/// Coût: une passe de SHA-256 sur 450 ko, mesurée à 0,3 ms sur cette machine,
/// et seulement quand quelqu'un charge la page. Pas de cache: un état global
/// gardé entre deux pages ne peut se tromper qu'une fois, mais il se trompe
/// alors sur toutes les suivantes, et une première version de cette fonction
/// s'est fait attraper là-dessus par ses propres tests.
pub(super) fn script_policy(page: &str) -> String {
    use base64::Engine as _;
    use sha2::Digest as _;

    let mut allowed = String::from("'self'");
    let mut rest = page;
    // Le contenu de chaque `<script ...>` jusqu'à son `</script>`. Une recherche
    // de texte plutôt qu'un analyseur HTML: on cherche une balise dans un
    // fichier qu'on a construit soi-même, pas dans du HTML trouvé.
    while let Some(open) = rest.find("<script")
        && let Some(head) = rest[open..].find('>')
        && let Some(close) = rest[open + head + 1..].find("</script>")
    {
        let body = &rest[open + head + 1..open + head + 1 + close];
        let digest = sha2::Sha256::digest(body.as_bytes());
        allowed.push_str(" 'sha256-");
        allowed.push_str(&base64::engine::general_purpose::STANDARD.encode(digest));
        allowed.push('\'');
        rest = &rest[open + head + 1 + close..];
    }
    allowed
}

/// La politique complète, empreinte comprise.
///
/// Stricte parce que la page peut se le permettre: un fichier unique, sans
/// ressource externe, avec ses styles et son script à l'intérieur. Tout ce qui
/// viendrait d'ailleurs est refusé, y compris une image.
pub(super) fn policy_headers(page: &str) -> String {
    format!(
        "Content-Security-Policy: default-src 'self'; script-src {}; \
         style-src 'self' 'unsafe-inline'; img-src 'self' data:; \
         connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'\r\n{HARDENING}",
        script_policy(page)
    )
}

/// Comment la page part sur le fil.
///
/// Trois états et pas deux booléens, parce que deux booléens autorisent
/// « brotli ET gzip », qui ne veut rien dire: une réponse porte un encodage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Packing {
    /// Telle quelle. Le cas d'un client qui n'a rien demandé.
    Raw,
    Gzip,
    /// Treize pour cent de moins que gzip sur cette page, mesuré le 19 août
    /// 2026: 136 493 octets contre 117 841. Sur un lien à 400 kbit/s, la
    /// première image passe de 2,73 s à 2,36 s.
    ///
    /// Le niveau le plus élevé ne coûte rien ici, et c'est ce qui rend le choix
    /// évident: la page est un artefact FIGÉ, compilé dans le binaire, donc elle
    /// est compressée une fois au premier envoi et jamais plus.
    Brotli,
}

/// La page, dans l'emballage demandé.
///
/// Compressée une seule fois par emballage et gardée: la page est un artefact
/// figé compilé dans le binaire, donc le travail ne se refait jamais. C'est ce
/// qui permet de prendre le niveau brotli le plus élevé sans y penser.
pub(super) fn packed(page: &str, packing: Packing) -> &[u8] {
    static ZIPPED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    static BROTLIED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    match packing {
        Packing::Raw => page.as_bytes(),
        Packing::Gzip => ZIPPED.get_or_init(|| {
            use flate2::{Compression, write::GzEncoder};
            let mut packer = GzEncoder::new(Vec::new(), Compression::best());
            let _ = packer.write_all(page.as_bytes());
            packer.finish().unwrap_or_else(|_| page.as_bytes().to_vec())
        }),
        Packing::Brotli => BROTLIED.get_or_init(|| {
            let mut out = Vec::new();
            let mut packer = brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
            let _ = packer.write_all(page.as_bytes());
            drop(packer);
            if out.is_empty() {
                page.as_bytes().to_vec()
            } else {
                out
            }
        }),
    }
}

pub(super) fn serve_page(mut stream: TcpStream, page: &str, packing: Packing) {
    let hardening = policy_headers(page);
    let tag = format!("\"{:x}\"", page_tag(page));

    // Déjà à jour chez le client: on ne renvoie rien du tout. Lu sur l'entête
    // qu'on a déjà en main, en minuscules, d'où la comparaison en minuscules.
    let mut head = [0_u8; 2048];
    let read = stream.read(&mut head).unwrap_or(0);
    let request = String::from_utf8_lossy(&head[..read]).to_lowercase();
    if request.contains(&tag.to_lowercase()) {
        let response = format!(
            "HTTP/1.1 304 Not Modified\r\nETag: {tag}\r\n\
             Cache-Control: no-cache\r\n{hardening}Connection: close\r\n\r\n"
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        return;
    }

    let body = packed(page, packing);
    // Le repli est visible: si la compression a échoué, on a rendu les octets
    // bruts, et annoncer un encodage dessus donnerait une page illisible.
    let encoding = if body.len() == page.len() {
        ""
    } else {
        packing.header()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n{encoding}ETag: {tag}\r\n\
         Cache-Control: no-cache\r\n{hardening}Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Une étiquette de version pour la page, tirée de son contenu.
///
/// Un condensat rapide et non cryptographique: il ne protège rien, il distingue
/// deux versions. Deux pages différentes qui tomberaient sur la même valeur
/// serviraient une page périmée, ce qui vaut ici un rechargement manuel et non
/// une faille.
pub(super) fn page_tag(page: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    page.len().hash(&mut hasher);
    page.hash(&mut hasher);
    hasher.finish()
}

pub(super) fn serve_body(mut stream: TcpStream, body: &str, content_type: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    // The request is still unread because `classify` only peeked; draining it
    // keeps the client from seeing a reset before it has read the response.
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// La CSP nommait `'unsafe-inline'`, ce qui autorise n'importe quel script
    /// en ligne et retire à la règle presque tout son intérêt. L'empreinte est
    /// calculée sur la page qu'on sert, donc elle ne peut pas diverger.
    #[test]
    fn the_policy_names_the_script_of_the_page_it_serves() {
        let page = "<html><script>alert(1)</script></html>";

        let policy = script_policy(page);

        assert!(policy.starts_with("'self' "), "{policy}");
        assert!(policy.contains("'sha256-"), "{policy}");
        assert!(!policy.contains("unsafe-inline"), "{policy}");
    }

    /// Le jumeau, et c'est celui qui compte: une empreinte prise sur autre chose
    /// que le contenu exact du script laisserait la page refuser de s'exécuter,
    /// ce qui est un écran noir. Vérifié contre la vraie page.
    #[test]
    fn the_hash_is_the_one_a_browser_computes() {
        use base64::Engine as _;
        use sha2::Digest as _;

        let page = include_str!("../../../worker/src/page/index.html");
        let open = page.find("<script").expect("la page a un script en ligne");
        let head = page[open..].find('>').expect("la balise se ferme");
        let close = page[open + head + 1..]
            .find("</script>")
            .expect("le script se ferme");
        let body = &page[open + head + 1..open + head + 1 + close];
        let expected = base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(body));

        assert!(
            script_policy(page).contains(&expected),
            "l'empreinte annoncée n'est pas celle du script servi"
        );
    }

    /// Et les styles gardent `'unsafe-inline'`, délibérément: React pose des
    /// ATTRIBUTS `style`, que les empreintes ne couvrent pas. Une règle faible
    /// qu'on croit forte serait pire qu'une règle faible.
    #[test]
    fn the_style_rule_stays_honest_about_what_it_does_not_cover() {
        let headers = policy_headers("<html><script>x</script></html>");

        assert!(headers.contains("style-src 'self' 'unsafe-inline'"));
        assert!(!headers.contains("script-src 'self' 'unsafe-inline'"));
        assert!(headers.contains("frame-ancestors 'none'"));
        // Un saut de ligne au milieu couperait la réponse en deux.
        assert!(headers.ends_with("\r\n"));
        assert!(!headers.contains("\n\n"));
    }

    /// La lecture d'avant cherchait « gzip » n'importe où dans le texte de la
    /// requête, donc un chemin ou un agent qui contenait ces quatre lettres
    /// suffisait à déclencher une compression que personne n'avait demandée.
    #[test]
    fn the_encoding_is_read_on_its_own_header() {
        for (head, want) in [
            ("accept-encoding: br, gzip\r\n", Packing::Brotli),
            ("accept-encoding: gzip, deflate\r\n", Packing::Gzip),
            // Brotli d'abord quand les deux sont offerts, quelles que soient les
            // préférences annoncées: il est plus petit, et tout navigateur qui
            // connaît brotli connaît gzip.
            ("accept-encoding: gzip;q=1.0, br;q=0.5\r\n", Packing::Brotli),
            ("accept-encoding: identity\r\n", Packing::Raw),
            ("accept-encoding: \r\n", Packing::Raw),
            ("", Packing::Raw),
        ] {
            assert_eq!(Packing::wanted(head), want, "sur {head:?}");
        }
    }

    /// Le jumeau, et c'est le défaut qu'on répare: ces quatre lettres se
    /// trouvent ailleurs que dans l'en-tête qui les concerne.
    #[test]
    fn the_word_elsewhere_in_the_request_asks_for_nothing() {
        for head in [
            "get /art/gzip.png http/1.1\r\nhost: x\r\n",
            "get / http/1.1\r\nuser-agent: mon-navigateur-brotli\r\n",
            "get / http/1.1\r\nreferer: https://exemple/br\r\n",
        ] {
            assert_eq!(Packing::wanted(head), Packing::Raw, "sur {head:?}");
        }
    }

    /// Et l'emballage annoncé doit correspondre à celui qui a servi: annoncer
    /// gzip sur des octets brotli rend une page illisible, sans erreur nulle
    /// part côté serveur.
    #[test]
    fn each_packing_names_itself_and_only_itself() {
        assert_eq!(Packing::Raw.header(), "");
        assert!(Packing::Gzip.header().contains("gzip"));
        assert!(Packing::Brotli.header().contains("br"));
        assert!(!Packing::Brotli.header().contains("gzip"));
    }

    /// Brotli tient sa promesse, sur la vraie page et pas sur un exemple choisi.
    /// Mesuré le 19 août 2026: 136 493 octets en gzip contre 117 841 en brotli,
    /// soit 13,7 % de moins et 370 ms gagnés sur un lien à 400 kbit/s.
    #[test]
    fn brotli_is_smaller_than_gzip_on_the_page_we_actually_ship() {
        let page = include_str!("../../../worker/src/page/index.html");

        let zipped = packed(page, Packing::Gzip).len();
        let brotlied = packed(page, Packing::Brotli).len();

        assert!(brotlied < zipped, "brotli {brotlied} contre gzip {zipped}");
        assert!(zipped < page.len());
    }
}
