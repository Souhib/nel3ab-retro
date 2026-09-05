//! Ce que les tests de ce module partagent.
//!
//! Un fichier à part plutôt qu'une copie par module: monter un vrai serveur
//! demande six arguments dont cinq ne changent jamais, et une fixture recopiée
//! quatre fois est quatre endroits où corriger le jour où le constructeur
//! change.
//!
//! Compilé seulement en test, et jamais dans le binaire livré.

#![expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]

use std::net::{SocketAddr, TcpStream};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use nel3ab_protocol::PlayerSlot;

use super::{BrowserServer, Framed, PORTS, Packet, Viewer};

/// Builds a server with no accept loop, for tests that only exercise policy.
pub(in crate::browser) fn detached(viewers: Vec<SyncSender<Framed>>) -> BrowserServer {
    BrowserServer {
        clips: Arc::new(Mutex::new(crate::clip::Clips::new())),
        seats: Arc::new(Mutex::new([None; PORTS])),
        wants_save: Arc::new(Mutex::new(0)),
        wants_pad: Arc::new(Mutex::new(0_u8)),
        acted: Arc::new(Mutex::new([None; PORTS])),
        wants_extension: Arc::new(Mutex::new([None; PORTS])),
        granted_key: Arc::new(Mutex::new(BrowserServer::key_frame_epoch())),
        half_granted_key: Arc::new(Mutex::new(BrowserServer::key_frame_epoch())),
        owner: Arc::new(Mutex::new(None)),
        half_viewers: Arc::new(Mutex::new(Vec::new())),
        half_joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        half_wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        half_ready: Arc::new(std::sync::atomic::AtomicU8::new(super::HALF_UNKNOWN)),
        viewers: Arc::new(Mutex::new(viewers.into_iter().map(Viewer::new).collect())),
        listeners: Arc::new(Mutex::new(Vec::new())),
        arrived: Arc::new(Condvar::new()),
        incoming: Arc::new(Mutex::new([None; PORTS])),
        received: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        address: "127.0.0.1:0".parse().unwrap(),
        rumbles: Arc::new(Mutex::new([0; PORTS])),
        dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        half_dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        wants_rom: Arc::new(Mutex::new(None)),
        _accept: std::thread::spawn(|| {}),
    }
}

pub(in crate::browser) fn frame() -> Packet<'static> {
    Packet {
        captured_micros: 0,
        annex_b: &[0, 0, 0, 1, 0x65],
    }
}

/// Une image qui n'est PAS une clé: NAL de type 1.
pub(in crate::browser) fn delta() -> Packet<'static> {
    Packet {
        captured_micros: 0,
        annex_b: &[0, 0, 0, 1, 0x41],
    }
}

/// A full room, for tests that are not about the room being full.
pub(in crate::browser) fn four() -> PlayerSlot {
    PlayerSlot::new(4).unwrap()
}

/// Aucun propriétaire déclaré: la salle applique alors sa règle d'avant, où
/// tenir une manette suffit à changer de jeu. C'est ce que ces essais
/// vérifiaient déjà, et ce que fait une salle sans plan de contrôle.
/// A room whose games have no pictures, which is every room in these tests:
/// what is under test here is the serving, not the drawing.
pub(in crate::browser) fn no_art() -> Arc<[Option<Arc<[u8]>>]> {
    Arc::from(Vec::new())
}

pub(in crate::browser) fn nobody() -> crate::control::OwnerSeat {
    Arc::new(Mutex::new(None))
}

/// Connects a real WebSocket to a real server, because keep-alives are a
/// property of the connection thread and not of `send`.
pub(in crate::browser) fn watch(
    address: SocketAddr,
) -> tungstenite::WebSocket<std::net::TcpStream> {
    use tungstenite::client::IntoClientRequest as _;

    let stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let (socket, _) = tungstenite::client(
        format!("ws://{address}/video")
            .as_str()
            .into_client_request()
            .unwrap(),
        stream,
    )
    .unwrap();
    socket
}

/// Attend qu'une condition devienne vraie, sans dormir une durée choisie au
/// hasard. Rend faux si elle ne vient jamais.
pub(in crate::browser) fn eventually(mut what: impl FnMut() -> bool) -> bool {
    for _ in 0..300 {
        if what() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

/// Takes a controller and returns the socket with the port it was given.
pub(in crate::browser) fn hold(
    address: SocketAddr,
) -> (tungstenite::WebSocket<std::net::TcpStream>, u8) {
    use tungstenite::client::IntoClientRequest as _;
    let stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let (mut socket, _) = tungstenite::client(
        format!("ws://{address}/input")
            .as_str()
            .into_client_request()
            .unwrap(),
        stream,
    )
    .unwrap();
    let told = socket.read().unwrap().into_data();
    assert_eq!(
        told.len(),
        3 + PORTS,
        "the room is announced in one message"
    );
    (socket, told[1])
}

/// Takes a controller, naming the port it wants.
pub(in crate::browser) fn insist_on(
    address: SocketAddr,
    port: u8,
) -> (tungstenite::WebSocket<std::net::TcpStream>, u8) {
    use tungstenite::client::IntoClientRequest as _;
    let stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let (mut socket, _) = tungstenite::client(
        format!("ws://{address}/input?take={port}")
            .as_str()
            .into_client_request()
            .unwrap(),
        stream,
    )
    .unwrap();
    let told = socket.read().unwrap().into_data();
    (socket, told[1])
}
