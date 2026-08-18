//! Receiving emulator frames over the dma-buf socket.
//!
//! # The ordering this encodes
//!
//! Dolphin *connects*; we listen. So the socket has to exist before the emulator
//! starts, and [`FrameListener`] is what proves it does — it is the thing you
//! must be holding before spawning Dolphin, and the only way to obtain a
//! [`FrameSource`]. The same two-phase shape as M1's pipes, for the same reason:
//! the constraint lives in the types instead of in a comment nobody reads.
//!
//! # The invariant that matters
//!
//! Dolphin will not reuse a slot until we release it, and it drops frames while
//! it has none free. So a release that never happens stalls the stream, and a
//! release sent twice hands the emulator a slot we are still reading.
//!
//! [`LentFrame`] makes both impossible: it releases on drop, and it borrows the
//! source mutably so a second frame cannot be taken while one is held. There is
//! no `release()` to forget and none to call twice.

use std::io::{IoSliceMut, Read as _, Write as _};
use std::os::fd::{AsRawFd as _, RawFd};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nix::sys::socket::{ControlMessageOwned, MsgFlags, recvmsg};

use crate::error::EncoderError;
use crate::protocol::{
    FRAME_READY_LEN, FrameDescriptor, FrameReady, HEADER_LEN, HEADER_MAGIC, Header, encode_release,
};

/// How often the accept loop checks for a producer.
const ACCEPT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// A dma-buf file descriptor this process owns.
///
/// Exists so the fd is closed exactly once, by scope, rather than by everyone
/// remembering. It is deliberately NOT an `OwnedFd`: building one from a raw
/// descriptor requires `unsafe`, and this crate has no proof to offer for it —
/// the FFI module that M2 justifies is the libva binding, not this.
#[derive(Debug)]
pub struct DmaBuf(RawFd);

impl DmaBuf {
    /// Takes ownership of a descriptor another API has handed over.
    ///
    /// The caller must not close it afterwards — libva transfers ownership on
    /// export, and this type is what closes it exactly once.
    ///
    /// Gated because libva is the only caller: without the feature this would be
    /// dead code, and dead code is a warning, and a warning is a failure.
    #[cfg(feature = "vaapi")]
    #[must_use]
    pub(crate) const fn from_owned_raw(fd: RawFd) -> Self {
        Self(fd)
    }

    /// The descriptor, for handing to Vulkan.
    ///
    /// Borrowed on purpose: the importer duplicates it, and an owner that gave
    /// the number away could not know when to close it.
    #[must_use]
    pub const fn as_raw_fd(&self) -> RawFd {
        self.0
    }
}

impl Drop for DmaBuf {
    fn drop(&mut self) {
        // Nothing useful to do if this fails, and a Drop that shouts turns one
        // problem into two.
        let _ = nix::unistd::close(self.0);
    }
}

/// A bound frame socket, waiting for the emulator to connect.
///
/// Must exist before Dolphin starts: the patch connects during Vulkan backend
/// init and gives up quietly if nothing is listening.
#[derive(Debug)]
pub struct FrameListener {
    listener: UnixListener,
    path: PathBuf,
}

impl FrameListener {
    /// Binds the socket, replacing a stale one left by a crashed run.
    ///
    /// # Errors
    /// [`EncoderError::Bind`].
    pub fn bind(path: impl Into<PathBuf>) -> Result<Self, EncoderError> {
        let path = path.into();
        // A leftover socket file makes bind fail with EADDRINUSE even though
        // nobody is listening, which reads as "the port is taken" and is not.
        let _ = std::fs::remove_file(&path);
        let listener = UnixListener::bind(&path).map_err(|source| EncoderError::Bind {
            path: path.clone(),
            source,
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|source| EncoderError::Bind {
                path: path.clone(),
                source,
            })?;
        Ok(Self { listener, path })
    }

    /// Where the emulator should be told to connect.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Waits for the emulator and reads the whole ring.
    ///
    /// Consumes the listener: one emulator per socket, and a second producer
    /// would describe a ring we have already imported.
    ///
    /// # Errors
    /// [`EncoderError::NoProducer`] on timeout, or any parse failure from the
    /// descriptors that follow.
    pub fn accept(self, timeout: Duration) -> Result<FrameSource, EncoderError> {
        let deadline = Instant::now() + timeout;
        let stream = loop {
            match self.listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(EncoderError::NoProducer { waited: timeout });
                    }
                    std::thread::sleep(ACCEPT_POLL_INTERVAL);
                }
                Err(source) => {
                    return Err(EncoderError::Socket {
                        what: "accepting the emulator",
                        source,
                    });
                }
            }
        };
        stream
            .set_nonblocking(false)
            .map_err(|source| EncoderError::Socket {
                what: "switching the frame socket to blocking",
                source,
            })?;
        FrameSource::receive_ring(stream, self.path.clone())
    }
}

impl Drop for FrameListener {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// The emulator's frame ring, imported and ready to consume.
#[derive(Debug)]
pub struct FrameSource {
    stream: UnixStream,
    path: PathBuf,
    descriptor: FrameDescriptor,
    slots: Vec<DmaBuf>,
}

impl FrameSource {
    fn receive_ring(stream: UnixStream, path: PathBuf) -> Result<Self, EncoderError> {
        let (descriptor, slots) = collect_ring(&stream, None)?;
        Ok(Self {
            stream,
            path,
            descriptor,
            slots,
        })
    }

    /// Prend un anneau NEUF, annoncé en cours de route.
    ///
    /// Le premier descripteur est déjà arrivé: on l'a lu en croyant lire une
    /// notification d'image, avec son fichier. On récupère les autres et on
    /// remplace tout.
    ///
    /// Les anciens `DmaBuf` sont fermés en étant remplacés, ce qui est exactement
    /// ce qu'il faut: Dolphin a détruit ses images, et garder les descripteurs
    /// ouverts retiendrait de la mémoire graphique que plus personne ne lit.
    fn adopt(&mut self, first: (Header, DmaBuf)) -> Result<(), EncoderError> {
        let (descriptor, slots) = collect_ring(&self.stream, Some(first))?;
        self.descriptor = descriptor;
        self.slots = slots;
        Ok(())
    }

    /// The layout shared by every slot.
    #[must_use]
    pub const fn descriptor(&self) -> &FrameDescriptor {
        &self.descriptor
    }

    /// How many images the ring holds.
    #[must_use]
    pub const fn slot_count(&self) -> usize {
        self.slots.len()
    }

    /// The dma-buf backing a slot, for importing into Vulkan once at startup.
    #[must_use]
    pub fn slot(&self, index: usize) -> Option<&DmaBuf> {
        self.slots.get(index)
    }

    /// The socket the emulator was told to connect to.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Blocks until the emulator hands over a finished frame.
    ///
    /// The returned guard releases the slot when it is dropped, so the frame is
    /// held exactly as long as it is in scope and no longer.
    ///
    /// # Errors
    /// [`EncoderError::ProducerGone`] when the emulator exits, or a parse
    /// failure on a malformed notification.
    pub fn next_frame(&mut self) -> Result<LentFrame<'_>, EncoderError> {
        let mut bytes = [0u8; FRAME_READY_LEN];
        let (read, fd) = receive_with_fd(&self.stream, &mut bytes)?;
        if read == 0 {
            return Err(EncoderError::ProducerGone);
        }

        // Une ANNONCE d'anneau là où on attendait une image.
        //
        // Le patch recrée son anneau dès que la taille de rendu change, et
        // beaucoup de jeux en changent: Super Mario Strikers présente ses menus
        // à la taille native, Mario Power Tennis passe de 50 à 60 Hz et donc de
        // 528 lignes à 448. Avant, on lisait les seize premiers octets d'une
        // annonce qui en fait soixante-quatre, on ne reconnaissait pas le motif,
        // et le worker s'arrêtait. Comme le jeu refaisait la même chose au
        // redémarrage suivant, la salle tournait en boucle.
        //
        // Ici on ADOPTE: on finit de lire l'annonce, on ramasse les autres
        // emplacements, et on rend une erreur nommée pour que l'appelant
        // reconstruise ce qui dépend de la taille. Le descripteur du dma-buf est
        // arrivé avec ces seize octets, d'où la lecture par `recvmsg`.
        if u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) == HEADER_MAGIC {
            let mut whole = [0u8; HEADER_LEN];
            whole[..FRAME_READY_LEN].copy_from_slice(&bytes);
            self.stream
                .read_exact(&mut whole[FRAME_READY_LEN..])
                .map_err(|source| EncoderError::Socket {
                    what: "reading the rest of a new ring descriptor",
                    source,
                })?;
            let header = Header::parse(&whole)?;
            let Some(fd) = fd else {
                return Err(EncoderError::Socket {
                    what: "a new ring descriptor arrived without its dma-buf",
                    source: std::io::Error::from(std::io::ErrorKind::InvalidData),
                });
            };
            self.adopt((header, DmaBuf(fd)))?;
            return Err(EncoderError::RingChanged {
                width: self.descriptor.width,
                height: self.descriptor.height,
                slots: u32::try_from(self.slots.len()).unwrap_or(0),
            });
        }

        if read != FRAME_READY_LEN {
            return Err(EncoderError::Socket {
                what: "a frame notification arrived cut short",
                source: std::io::Error::from(std::io::ErrorKind::UnexpectedEof),
            });
        }
        let ready = FrameReady::parse(&bytes)?;
        let slot_count = self.slots.len();
        if ready.slot as usize >= slot_count {
            return Err(EncoderError::SlotOutOfRange {
                slot: ready.slot,
                #[allow(
                    clippy::cast_possible_truncation,
                    reason = "the ring is three slots; it cannot exceed u32"
                )]
                slot_count: slot_count as u32,
            });
        }
        Ok(LentFrame {
            source: self,
            slot: ready.slot,
            frame_number: ready.frame_number,
        })
    }

    fn release(&mut self, slot: u32) {
        if let Err(error) = self.stream.write_all(&encode_release(slot)) {
            // The emulator going away is how a session ends; it is not worth an
            // error path on a Drop that has nothing left to do about it.
            tracing::debug!(slot, %error, "could not release the frame slot");
        }
    }
}

/// A frame the emulator has lent us, released when this is dropped.
///
/// Borrows the source mutably, so a second frame cannot be taken while this one
/// is alive — which is exactly the property Dolphin's ring assumes.
#[derive(Debug)]
pub struct LentFrame<'a> {
    source: &'a mut FrameSource,
    slot: u32,
    frame_number: u64,
}

impl LentFrame<'_> {
    /// Which slot of the ring holds this frame.
    #[must_use]
    pub const fn slot(&self) -> u32 {
        self.slot
    }

    /// The emulator's monotonic frame counter, starting at 1.
    ///
    /// Gaps are meaningful: they are frames Dolphin dropped because every slot
    /// was still lent out, which is the signal that this end is too slow.
    #[must_use]
    pub const fn frame_number(&self) -> u64 {
        self.frame_number
    }

    /// The dma-buf holding the pixels.
    #[must_use]
    pub fn dma_buf(&self) -> Option<&DmaBuf> {
        self.source.slots.get(self.slot as usize)
    }
}

impl Drop for LentFrame<'_> {
    fn drop(&mut self) {
        self.source.release(self.slot);
    }
}

/// Rassemble un anneau complet: un descripteur par emplacement, chacun avec son
/// fichier.
///
/// `first` porte le descripteur déjà lu, quand l'appelant en tenait un. C'est le
/// cas d'un anneau annoncé EN COURS DE ROUTE: le premier descripteur arrive là
/// où on attendait une image, et on l'a donc déjà consommé avec son fichier.
///
/// Une fonction plutôt que deux boucles jumelles: l'anneau de départ et l'anneau
/// de remplacement se lisent exactement pareil, et deux copies de cette
/// vérification finiraient par diverger sur le cas qui compte.
fn collect_ring(
    stream: &UnixStream,
    first: Option<(Header, DmaBuf)>,
) -> Result<(FrameDescriptor, Vec<DmaBuf>), EncoderError> {
    let mut slots: Vec<Option<DmaBuf>> = Vec::new();
    let mut descriptor: Option<FrameDescriptor> = None;
    let mut remaining = usize::MAX;
    let mut held = first;

    while slots.iter().filter(|slot| slot.is_some()).count() < remaining {
        let (header, fd) = match held.take() {
            Some(already) => already,
            None => receive_header_with_fd(stream)?,
        };
        if remaining == usize::MAX {
            remaining = header.slot_count as usize;
            slots.resize_with(remaining, || None);
            descriptor = Some(header.descriptor);
        }
        let index = header.slot as usize;
        let Some(place) = slots.get_mut(index) else {
            return Err(EncoderError::SlotOutOfRange {
                slot: header.slot,
                slot_count: header.slot_count,
            });
        };
        if place.is_some() {
            return Err(EncoderError::DuplicateSlot { slot: header.slot });
        }
        // Every slot is allocated together from one modifier list; if they
        // disagree we are not talking to the patch we ship.
        if descriptor != Some(header.descriptor) {
            return Err(EncoderError::InconsistentRing { slot: header.slot });
        }
        *place = Some(fd);
    }

    let (Some(descriptor), true) = (descriptor, !slots.is_empty()) else {
        return Err(EncoderError::EmptyRing);
    };
    // Every entry was filled or the loop would not have ended.
    Ok((descriptor, slots.into_iter().flatten().collect()))
}

/// Lit des octets ET le fichier qui les accompagne, s'il y en a un.
///
/// Toujours par `recvmsg`, jamais par `read`: les données auxiliaires voyagent
/// avec le PREMIER octet d'un message, et un `read` ordinaire les jette. Ça n'a
/// l'air de rien tant qu'on ne lit que des notifications d'image, qui n'en
/// portent pas. Le jour où une annonce d'anneau arrive à cette place, le
/// descripteur du dma-buf partirait en silence et l'anneau serait inadoptable.
fn receive_with_fd(
    stream: &UnixStream,
    bytes: &mut [u8],
) -> Result<(usize, Option<RawFd>), EncoderError> {
    let mut iov = [IoSliceMut::new(bytes)];
    let mut cmsg = nix::cmsg_space!([RawFd; 1]);

    let message = recvmsg::<()>(
        stream.as_raw_fd(),
        &mut iov,
        Some(&mut cmsg),
        MsgFlags::empty(),
    )
    .map_err(|errno| EncoderError::Socket {
        what: "reading from the emulator",
        source: std::io::Error::from_raw_os_error(errno as i32),
    })?;

    let mut received: Option<RawFd> = None;
    for control in message.cmsgs().map_err(|errno| EncoderError::Socket {
        what: "reading ancillary data",
        source: std::io::Error::from_raw_os_error(errno as i32),
    })? {
        if let ControlMessageOwned::ScmRights(fds) = control {
            for fd in fds {
                match received {
                    // Exactly one fd per descriptor. A second would leak.
                    None => received = Some(fd),
                    Some(_) => {
                        let _ = nix::unistd::close(fd);
                    }
                }
            }
        }
    }
    Ok((message.bytes, received))
}

/// Reads one descriptor and the descriptor's file descriptor together.
///
/// They arrive in the same `sendmsg`, and they have to be taken in the same
/// `recvmsg`: ancillary data rides on the first byte of a message, so reading
/// the bytes with `read` first would drop the fd on the floor.
fn receive_header_with_fd(stream: &UnixStream) -> Result<(Header, DmaBuf), EncoderError> {
    let mut bytes = [0u8; HEADER_LEN];

    // The scope is load-bearing: `iov` borrows `bytes` mutably for as long as it
    // lives, so the descriptor cannot be parsed until it is gone.
    let (received_len, fd) = {
        let mut iov = [IoSliceMut::new(&mut bytes)];
        let mut cmsg = nix::cmsg_space!([RawFd; 1]);

        let message = recvmsg::<()>(
            stream.as_raw_fd(),
            &mut iov,
            Some(&mut cmsg),
            MsgFlags::empty(),
        )
        .map_err(|errno| EncoderError::Socket {
            what: "reading a ring descriptor",
            source: std::io::Error::from_raw_os_error(errno as i32),
        })?;

        let mut received: Option<RawFd> = None;
        for control in message.cmsgs().map_err(|errno| EncoderError::Socket {
            what: "reading the descriptor's ancillary data",
            source: std::io::Error::from_raw_os_error(errno as i32),
        })? {
            if let ControlMessageOwned::ScmRights(fds) = control {
                for fd in fds {
                    match received {
                        // Exactly one fd per descriptor. A second would leak.
                        None => received = Some(fd),
                        Some(_) => {
                            let _ = nix::unistd::close(fd);
                        }
                    }
                }
            }
        }
        (message.bytes, received)
    };

    if received_len == 0 {
        return Err(EncoderError::ProducerGone);
    }

    // Parsed only after the fd is in hand, so a malformed descriptor still
    // closes its descriptor instead of leaking it.
    let header = match Header::parse(bytes.get(..received_len).unwrap_or(&bytes)) {
        Ok(header) => header,
        Err(error) => {
            if let Some(fd) = fd {
                let _ = nix::unistd::close(fd);
            }
            return Err(error);
        }
    };

    fd.map_or(Err(EncoderError::MissingFd { slot: header.slot }), |fd| {
        Ok((header, DmaBuf(fd)))
    })
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use crate::protocol::{FRAME_MAGIC, HEADER_MAGIC, PROTOCOL_VERSION, RELEASE_LEN};
    use std::io::IoSlice;
    use std::os::fd::AsRawFd;
    use std::thread;

    fn socket_path(tag: &str) -> PathBuf {
        std::env::temp_dir().join(format!("nel3ab-test-{tag}-{}.sock", std::process::id()))
    }

    fn header_bytes(slot: u32, slot_count: u32, magic: u32, version: u32) -> [u8; HEADER_LEN] {
        sized_header(slot, slot_count, magic, version, 640, 480)
    }

    /// Le même, avec une taille choisie: c'est elle qui change quand un jeu
    /// change de mode.
    fn sized_header(
        slot: u32,
        slot_count: u32,
        magic: u32,
        version: u32,
        width: u32,
        height: u32,
    ) -> [u8; HEADER_LEN] {
        let mut b = [0u8; HEADER_LEN];
        b[0..4].copy_from_slice(&magic.to_le_bytes());
        b[4..8].copy_from_slice(&version.to_le_bytes());
        b[8..12].copy_from_slice(&slot.to_le_bytes());
        b[12..16].copy_from_slice(&slot_count.to_le_bytes());
        b[16..20].copy_from_slice(&width.to_le_bytes());
        b[20..24].copy_from_slice(&height.to_le_bytes());
        b[24..28].copy_from_slice(&0x3432_4241u32.to_le_bytes());
        b[32..40].copy_from_slice(&0x0200_0000_1860_1b03u64.to_le_bytes());
        b[48..56].copy_from_slice(&2560u64.to_le_bytes());
        b[56..64].copy_from_slice(&1_310_720u64.to_le_bytes());
        b
    }

    fn frame_bytes(slot: u32, number: u64) -> [u8; FRAME_READY_LEN] {
        let mut b = [0u8; FRAME_READY_LEN];
        b[0..4].copy_from_slice(&FRAME_MAGIC.to_le_bytes());
        b[4..8].copy_from_slice(&slot.to_le_bytes());
        b[8..16].copy_from_slice(&number.to_le_bytes());
        b
    }

    /// Sends a descriptor with a real file descriptor attached, exactly as the
    /// patch does. The fd is a temp file rather than a dma-buf: this end only
    /// has to receive and own it, and nothing here imports it into Vulkan.
    fn send_header(stream: &UnixStream, bytes: &[u8], fd: RawFd) {
        let iov = [IoSlice::new(bytes)];
        let fds = [fd];
        let cmsg = [nix::sys::socket::ControlMessage::ScmRights(&fds)];
        nix::sys::socket::sendmsg::<()>(stream.as_raw_fd(), &iov, &cmsg, MsgFlags::empty(), None)
            .unwrap();
    }

    #[test]
    fn a_ring_arrives_with_one_descriptor_per_slot() {
        let path = socket_path("ring");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            for slot in 0..3 {
                send_header(
                    &stream,
                    &header_bytes(slot, 3, HEADER_MAGIC, PROTOCOL_VERSION),
                    file.as_raw_fd(),
                );
            }
            // Held open so the source does not see the producer vanish.
            std::thread::sleep(Duration::from_millis(200));
        });

        let source = listener.accept(Duration::from_secs(5)).unwrap();
        assert_eq!(source.slot_count(), 3);
        assert_eq!(source.descriptor().width, 640);
        assert_eq!(source.descriptor().pitch, 2560);
        // Every slot got its own descriptor, and they are distinct.
        for index in 0..3 {
            assert!(source.slot(index).unwrap().as_raw_fd() >= 0);
        }
        assert!(source.slot(3).is_none());
        producer.join().unwrap();
    }

    #[test]
    fn dropping_a_frame_releases_exactly_that_slot_once() {
        // The invariant Dolphin's ring depends on. A release that never arrives
        // stalls the stream; one that arrives twice hands back a slot we may
        // still be reading.
        let path = socket_path("release");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let mut stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            for slot in 0..3 {
                send_header(
                    &stream,
                    &header_bytes(slot, 3, HEADER_MAGIC, PROTOCOL_VERSION),
                    file.as_raw_fd(),
                );
            }
            stream.write_all(&frame_bytes(2, 600)).unwrap();
            let mut releases = Vec::new();
            let mut buf = [0u8; RELEASE_LEN];
            while stream.read_exact(&mut buf).is_ok() {
                releases.push(u32::from_le_bytes([buf[4], buf[5], buf[6], buf[7]]));
            }
            releases
        });

        let mut source = listener.accept(Duration::from_secs(5)).unwrap();
        {
            let frame = source.next_frame().unwrap();
            assert_eq!(frame.slot(), 2);
            assert_eq!(frame.frame_number(), 600);
            assert!(frame.dma_buf().is_some());
        }
        drop(source);

        let releases = producer.join().unwrap();
        assert_eq!(
            releases,
            vec![2],
            "expected exactly one release, for slot 2"
        );
    }

    #[test]
    fn an_absent_emulator_times_out_rather_than_waiting_forever() {
        // Negative twin of the happy path: if accept returned without a producer,
        // every test above would pass against a ring nobody ever sent.
        let listener = FrameListener::bind(socket_path("absent")).unwrap();
        let started = Instant::now();
        let error = listener.accept(Duration::from_millis(120)).unwrap_err();
        assert!(
            matches!(error, EncoderError::NoProducer { .. }),
            "{error:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn the_same_slot_described_twice_is_refused() {
        let path = socket_path("dupe");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            for _ in 0..2 {
                send_header(
                    &stream,
                    &header_bytes(0, 3, HEADER_MAGIC, PROTOCOL_VERSION),
                    file.as_raw_fd(),
                );
            }
            std::thread::sleep(Duration::from_millis(200));
        });
        let error = listener.accept(Duration::from_secs(5)).unwrap_err();
        assert!(
            matches!(error, EncoderError::DuplicateSlot { slot: 0 }),
            "{error:?}"
        );
        producer.join().unwrap();
    }

    #[test]
    fn a_notification_for_a_slot_outside_the_ring_is_refused() {
        let path = socket_path("oob");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let mut stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            for slot in 0..2 {
                send_header(
                    &stream,
                    &header_bytes(slot, 2, HEADER_MAGIC, PROTOCOL_VERSION),
                    file.as_raw_fd(),
                );
            }
            // Slot 7 does not exist in a ring of two.
            stream.write_all(&frame_bytes(7, 1)).unwrap();
            std::thread::sleep(Duration::from_millis(200));
        });
        let mut source = listener.accept(Duration::from_secs(5)).unwrap();
        let error = source.next_frame().unwrap_err();
        assert!(
            matches!(error, EncoderError::SlotOutOfRange { slot: 7, .. }),
            "{error:?}"
        );
        producer.join().unwrap();
    }

    #[test]
    fn an_emulator_that_exits_is_reported_as_gone_not_as_a_parse_error() {
        let path = socket_path("gone");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            for slot in 0..2 {
                send_header(
                    &stream,
                    &header_bytes(slot, 2, HEADER_MAGIC, PROTOCOL_VERSION),
                    file.as_raw_fd(),
                );
            }
            // Then the emulator quits, which is how a session normally ends.
        });
        let mut source = listener.accept(Duration::from_secs(5)).unwrap();
        producer.join().unwrap();
        assert!(
            matches!(source.next_frame().unwrap_err(), EncoderError::ProducerGone),
            "a closed socket must not look like a malformed message"
        );
    }

    #[test]
    fn a_descriptor_with_the_wrong_magic_is_refused() {
        let path = socket_path("magic");
        let listener = FrameListener::bind(&path).unwrap();
        let producer_path = path;
        let producer = thread::spawn(move || {
            let stream = UnixStream::connect(&producer_path).unwrap();
            let file = tempfile::tempfile().unwrap();
            send_header(
                &stream,
                &header_bytes(0, 3, 0xdead_beef, PROTOCOL_VERSION),
                file.as_raw_fd(),
            );
            std::thread::sleep(Duration::from_millis(200));
        });
        let error = listener.accept(Duration::from_secs(5)).unwrap_err();
        assert!(matches!(error, EncoderError::BadMagic { .. }), "{error:?}");
        producer.join().unwrap();
    }

    #[test]
    fn the_socket_file_is_removed_when_the_listener_goes() {
        // A leftover socket makes the next bind fail with EADDRINUSE, which
        // reads as "something is already listening" and is not.
        let path = socket_path("cleanup");
        {
            let _listener = FrameListener::bind(&path).unwrap();
            assert!(path.exists());
        }
        assert!(!path.exists());
    }

    /// Un anneau qui change de taille est ADOPTÉ, pas pris pour une panne.
    ///
    /// C'est le défaut qui faisait tourner la salle en boucle sur deux jeux.
    /// Super Mario Strikers présente ses menus à la taille native, et Mario
    /// Power Tennis passe de 50 à 60 Hz, donc de 528 lignes à 448. Les deux
    /// annoncent un anneau neuf en cours de partie.
    ///
    /// Le test tient sans GPU: rien ici n'importe quoi que ce soit dans Vulkan,
    /// on vérifie que le protocole est suivi et que les descripteurs arrivent.
    #[test]
    fn a_new_ring_announced_mid_stream_is_adopted() {
        let path = socket_path("adopt");
        let _ = std::fs::remove_file(&path);
        let listener = FrameListener::bind(&path).unwrap();

        let producer = thread::spawn({
            let path = path.clone();
            move || {
                let stream = UnixStream::connect(&path).unwrap();
                let file = std::fs::File::open("/dev/null").unwrap();
                for slot in 0..2 {
                    send_header(
                        &stream,
                        &sized_header(slot, 2, HEADER_MAGIC, PROTOCOL_VERSION, 640, 480),
                        file.as_raw_fd(),
                    );
                }
                // Une image ordinaire, puis un anneau NEUF d'une autre taille.
                stream
                    .try_clone()
                    .unwrap()
                    .write_all(&frame_bytes(0, 1))
                    .unwrap();
                thread::sleep(Duration::from_millis(50));
                for slot in 0..2 {
                    send_header(
                        &stream,
                        &sized_header(slot, 2, HEADER_MAGIC, PROTOCOL_VERSION, 320, 224),
                        file.as_raw_fd(),
                    );
                }
                thread::sleep(Duration::from_millis(200));
            }
        });

        let mut source = listener.accept(Duration::from_secs(5)).unwrap();
        assert_eq!(source.descriptor().width, 640);

        // La première image passe normalement.
        drop(source.next_frame().unwrap());

        // La suivante n'est pas une image: c'est le nouvel anneau.
        match source.next_frame() {
            Err(EncoderError::RingChanged {
                width,
                height,
                slots,
            }) => {
                assert_eq!((width, height, slots), (320, 224, 2));
            }
            other => panic!("un anneau neuf a été pris pour autre chose: {other:?}"),
        }

        // Et la source décrit maintenant le nouvel anneau, pas l'ancien.
        assert_eq!(source.descriptor().width, 320);
        assert_eq!(source.descriptor().height, 224);
        assert_eq!(source.slot_count(), 2);
        assert!(source.slot(0).is_some(), "le nouvel emplacement 0 est vide");

        producer.join().unwrap();
        let _ = std::fs::remove_file(&path);
    }
}
