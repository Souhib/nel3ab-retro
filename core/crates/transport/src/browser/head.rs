//! Lire tous les en-têtes HTTP sans prendre les premiers octets WebSocket.

use std::io::{self, Read as _};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use super::CLASSIFY_TIMEOUT;

// Borne de mémoire par connexion, pas une taille supposée des cookies.
// Choisie le 16 octobre 2026: 64 Kio laissent passer plusieurs cookies de 4 Kio
// tout en bornant une requête sans fin. La lecture précédente coupait à 2 Kio.
const MAX_HEAD: usize = 64 * 1024;

/// Attend la fin des en-têtes, en les laissant disponibles pour tungstenite.
pub(super) fn peek(stream: &TcpStream) -> io::Result<Vec<u8>> {
    peek_with_timeout(stream, CLASSIFY_TIMEOUT)
}

fn peek_with_timeout(stream: &TcpStream, timeout: Duration) -> io::Result<Vec<u8>> {
    let deadline = Instant::now() + timeout;
    let mut bytes = vec![0; MAX_HEAD];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "incomplete HTTP headers",
            ));
        }
        stream.set_read_timeout(Some(remaining))?;
        let read = stream.peek(&mut bytes)?;
        if read == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        if let Some(end) = bytes[..read]
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
        {
            bytes.truncate(end + 4);
            return Ok(bytes);
        }
        if read == MAX_HEAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "HTTP headers exceed 64 KiB",
            ));
        }
        // peek rend aussitôt les mêmes octets si la suite n'est pas arrivée.
        // Une pause de 1 ms évite de saturer un cœur. Elle ne concerne que la
        // requête initiale fragmentée, jamais les images ou les commandes.
        std::thread::sleep(Duration::from_millis(1).min(remaining));
    }
}

/// Consomme exactement les en-têtes avant de répondre puis fermer la socket.
pub(super) fn consume(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut bytes = peek(stream)?;
    stream.read_exact(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
#[expect(
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use std::io::Write as _;
    use std::net::TcpListener;

    use super::*;

    fn pair() -> (TcpStream, TcpStream) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listen");
        let client = TcpStream::connect(listener.local_addr().expect("address")).expect("connect");
        let (server, _) = listener.accept().expect("accept");
        (client, server)
    }

    #[test]
    fn consuming_headers_preserves_the_following_bytes() {
        let (mut client, mut server) = pair();
        let request = b"GET / HTTP/1.1\r\nHost: x\r\n\r\n";
        client.write_all(request).expect("headers");
        client.write_all(b"next").expect("following bytes");
        assert_eq!(peek(&server).expect("peek"), request);
        assert_eq!(consume(&mut server).expect("consume"), request);
        let mut next = [0; 4];
        server
            .read_exact(&mut next)
            .expect("following bytes remain");
        assert_eq!(&next, b"next");
    }

    #[test]
    fn complete_headers_at_the_limit_are_accepted_but_larger_ones_are_refused() {
        for extra in [0, 1] {
            let (mut client, server) = pair();
            let request = format!("{}\r\n\r\n", "x".repeat(MAX_HEAD - 4 + extra));
            client.write_all(request.as_bytes()).expect("request");
            let result = peek(&server);
            if extra == 0 {
                assert_eq!(result.expect("at the limit"), request.as_bytes());
            } else {
                assert_eq!(
                    result.expect_err("over the limit").kind(),
                    io::ErrorKind::InvalidData
                );
            }
        }
    }

    #[test]
    fn an_unfinished_request_cannot_keep_a_thread_forever() {
        let (mut client, server) = pair();
        client
            .write_all(b"GET / HTTP/1.1\r\n")
            .expect("partial request");
        let error =
            peek_with_timeout(&server, Duration::from_millis(30)).expect_err("incomplete request");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn a_closed_empty_connection_is_refused() {
        let (client, server) = pair();
        drop(client);
        assert_eq!(
            peek(&server).expect_err("closed").kind(),
            io::ErrorKind::UnexpectedEof
        );
    }
}
