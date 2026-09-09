//! Translation to the private virtual controllers. No browser device names or
//! physical event numbers cross the room's controller protocol.
use crate::browser::{BrowserServer, ControllerFrame, Packet};
use nel3ab_protocol::switch::SwitchFrame;
use std::{
    io::{self, Read, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixDatagram, UnixListener, UnixStream},
    },
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

/// Private capture and controller ingress. Dropping it stops all readers;
/// emulator lifecycle remains the caller's responsibility.
pub struct Ingress(Arc<AtomicBool>);
impl Drop for Ingress {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Relaxed);
    }
}
impl Ingress {
    /// Bind only a fresh private directory, never unlink another worker's sockets.
    pub fn bind(root: &Path, server: Arc<BrowserServer>) -> io::Result<Self> {
        let listener = UnixListener::bind(root.join("media.sock"))?;
        listener.set_nonblocking(true)?;
        let rumble_path = root.join("rumble.sock");
        let rumble = UnixDatagram::bind(&rumble_path)?;
        // The helper shares our group but has no DAC_OVERRIDE capability.
        // On 2026-09-09 the default 0755 socket refused its first vibration.
        // Keep other users out, and explicitly allow the private helper group.
        std::fs::set_permissions(&rumble_path, std::fs::Permissions::from_mode(0o660))?;
        rumble.set_read_timeout(Some(Duration::from_millis(100)))?;
        let input = UnixDatagram::unbound()?;
        let pad_address = root.join("pads.sock");
        let stopping = Arc::new(AtomicBool::new(false));
        let stopped = Arc::clone(&stopping);
        let output = Arc::clone(&server);
        thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                for frame in output.wait_controller_input(Duration::from_millis(50)) {
                    if let ControllerFrame::Switch(frame) = frame {
                        let bytes = command(frame).to_string();
                        if let Err(error) = input.send_to(bytes.as_bytes(), &pad_address) {
                            tracing::debug!(%error, "Switch virtual pads not yet available");
                        }
                    }
                }
            }
        });
        let stopped = Arc::clone(&stopping);
        let output = Arc::clone(&server);
        thread::spawn(move || {
            let mut bytes = [0; 3];
            while !stopped.load(Ordering::Relaxed) {
                if rumble.recv(&mut bytes).is_ok_and(|size| size == 2)
                    && let Ok(seat) = nel3ab_protocol::PlayerSlot::new(bytes[0])
                {
                    output.rumble(seat, bytes[1]);
                }
            }
        });
        let stopped = Arc::clone(&stopping);
        thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let output = Arc::clone(&server);
                        let stop = Arc::clone(&stopped);
                        thread::spawn(move || {
                            if let Err(error) = receive(stream, &output, &stop) {
                                tracing::info!(%error, "Switch capture connection ended");
                            }
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => {
                        tracing::error!(%error, "Switch capture listener failed");
                        break;
                    }
                }
            }
        });
        Ok(Self(stopping))
    }
}
fn read(stream: &mut UnixStream, mut bytes: &mut [u8], stop: &AtomicBool) -> io::Result<()> {
    while !bytes.is_empty() {
        if stop.load(Ordering::Relaxed) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        match stream.read(bytes) {
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(size) => bytes = &mut bytes[size..],
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
fn receive(mut stream: UnixStream, output: &BrowserServer, stop: &AtomicBool) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    loop {
        let mut header = [0u8; 13];
        read(&mut stream, &mut header, stop)?;
        let captured = u64::from_le_bytes(
            header[1..9]
                .try_into()
                .map_err(|_| io::ErrorKind::InvalidData)?,
        );
        let length = u32::from_le_bytes(
            header[9..13]
                .try_into()
                .map_err(|_| io::ErrorKind::InvalidData)?,
        ) as usize;
        // The recorder already rejects packets above 4 MiB. Bound before allocating.
        if length > 4 * 1024 * 1024 {
            return Err(io::ErrorKind::InvalidData.into());
        }
        if header[0] == b'D' {
            if length != 0 || captured != 0 {
                return Err(io::ErrorKind::InvalidData.into());
            }
            let full = output.take_joined() | output.take_key_frame_request();
            let half = output.take_half_joined() | output.take_half_key_frame_request();
            stream.write_all(&(output.half_watchers() as u64).to_le_bytes())?;
            stream.write_all(&[u8::from(full), u8::from(half)])?;
            continue;
        }
        let mut payload = vec![0; length];
        read(&mut stream, &mut payload, stop)?;
        let packet = Packet {
            captured_micros: captured,
            annex_b: &payload,
        };
        match header[0] {
            b'F' => {
                let _ = output.send(&packet);
            }
            b'H' => {
                let _ = output.send_half(&packet);
            }
            b'A' => {
                let _ = output.send_sound(captured, &payload);
            }
            _ => return Err(io::ErrorKind::InvalidData.into()),
        }
    }
}

/// Translate the room state to the four private Linux pads.
#[must_use]
pub fn command(frame: SwitchFrame) -> serde_json::Value {
    let bits = frame.buttons.bits();
    let buttons: Vec<_> = [
        (0, "a"),
        (1, "b"),
        (2, "x"),
        (3, "y"),
        (4, "l"),
        (5, "r"),
        (8, "minus"),
        (9, "plus"),
        (10, "ls"),
        (11, "rs"),
    ]
    .into_iter()
    .filter_map(|(bit, name)| (bits & (1_u32 << bit) != 0).then_some(name))
    .collect();
    let down = |bit: u32| i32::from(bits & (1_u32 << bit) != 0_u32);
    // The browser already sends signed 16-bit axes. Multiplying by 256 here
    // saturated a quarter-stick at the virtual device (red test, 2026-09-08).
    serde_json::json!({"player":frame.slot.get(),"buttons":buttons,"axes":{
        "lx":frame.left.x,"ly":-i32::from(frame.left.y),
        "rx":frame.right.x,"ry":-i32::from(frame.right.y),
        "zl":down(6)*255,"zr":down(7)*255,
        "dx":down(15)-down(14),"dy":down(13)-down(12)}})
}
#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "invalid fixtures must fail")]
mod tests {
    use super::*;
    use nel3ab_protocol::{PlayerSlot, Stick, switch::SwitchButtons};
    #[test]
    fn rumble_allows_the_private_helper_group_but_not_other_users() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = BrowserServer::start(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            Arc::from([]),
            PlayerSlot::new(4).unwrap(),
            &owner,
        )
        .unwrap();
        let _ingress = Ingress::bind(root.path(), Arc::new(server)).unwrap();
        let mode = std::fs::metadata(root.path().join("rumble.sock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode & 0o060, 0o060, "the helper shares the worker's group");
        assert_eq!(mode & 0o007, 0, "other users must not access the socket");
    }
    #[test]
    fn demand_is_bounded_and_unknown_media_is_refused() {
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = BrowserServer::start(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            Arc::from([]),
            PlayerSlot::new(4).unwrap(),
            &owner,
        )
        .unwrap();
        let (mut client, receiver) = UnixStream::pair().unwrap();
        let reader = thread::spawn(move || receive(receiver, &server, &AtomicBool::new(false)));
        let mut header = [0; 13];
        header[0] = b'D';
        client.write_all(&header).unwrap();
        let mut answer = [0; 10];
        client.read_exact(&mut answer).unwrap();
        assert_eq!(answer, [0; 10]);
        header[0] = b'?';
        client.write_all(&header).unwrap();
        assert_eq!(
            reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
    #[test]
    fn partial_headers_survive_timeouts_and_silent_readers_stop() {
        let (mut sender, mut receiver) = UnixStream::pair().unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        let reader = thread::spawn(move || {
            let mut bytes = [0; 4];
            read(&mut receiver, &mut bytes, &AtomicBool::new(false)).unwrap();
            bytes
        });
        sender.write_all(&[1, 2]).unwrap();
        thread::sleep(Duration::from_millis(80));
        sender.write_all(&[3, 4]).unwrap();
        assert_eq!(reader.join().unwrap(), [1, 2, 3, 4]);
        let (_sender, mut receiver) = UnixStream::pair().unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let other = Arc::clone(&stop);
        let reader = thread::spawn(move || read(&mut receiver, &mut [0; 4], &other));
        stop.store(true, Ordering::Relaxed);
        assert_eq!(
            reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
    }
    #[test]
    fn fractional_sticks_keep_their_precision_and_only_y_changes_sign() {
        let mut frame = SwitchFrame::neutral(PlayerSlot::new(2).unwrap());
        frame.left = Stick::new(8192, -4096);
        frame.right = Stick::new(-16384, 2048);
        let axes = &command(frame)["axes"];
        for (name, value) in [("lx", 8192), ("ly", 4096), ("rx", -16384), ("ry", -2048)] {
            assert_eq!(axes[name], value);
        }
        let neutral = command(SwitchFrame::neutral(frame.slot));
        assert_eq!(neutral["buttons"], serde_json::json!([]));
        for value in neutral["axes"].as_object().unwrap().values() {
            assert_eq!(value, 0);
        }
    }
    #[test]
    fn all_sixteen_controls_reach_a_distinct_virtual_input() {
        let expected = [
            ("a", 0),
            ("b", 1),
            ("x", 2),
            ("y", 3),
            ("l", 4),
            ("r", 5),
            ("minus", 8),
            ("plus", 9),
            ("ls", 10),
            ("rs", 11),
        ];
        for bit in 0..16 {
            let frame = SwitchFrame {
                buttons: SwitchButtons::from_bits(1 << bit).unwrap(),
                ..SwitchFrame::neutral(PlayerSlot::new(4).unwrap())
            };
            let got = command(frame);
            assert_eq!(got["player"], 4);
            let buttons: Vec<_> = expected
                .iter()
                .filter(|(_, b)| *b == bit)
                .map(|(name, _)| *name)
                .collect();
            assert_eq!(got["buttons"], serde_json::json!(buttons));
            for (axis, positive, negative) in
                [("zl", 6, 99), ("zr", 7, 99), ("dx", 15, 14), ("dy", 13, 12)]
            {
                let amount = if axis == "zl" || axis == "zr" { 255 } else { 1 };
                assert_eq!(
                    got["axes"][axis],
                    (i32::from(bit == positive) - i32::from(bit == negative)) * amount
                );
            }
        }
    }
}
