// Exercise the actual SDL session against SDL's dummy device. Keep it paused
// and invoke its real callback explicitly, so a slow CI machine cannot drain
// the deliberately queued samples before the assertion.
using System.Reflection;
using System.Runtime.InteropServices;
using Ryujinx.Audio.Backends.SDL2;
using Ryujinx.Audio.Common;
using Ryujinx.Audio.Integration;
using Ryujinx.Tests.Memory;
using static Ryujinx.Audio.Integration.IHardwareDeviceDriver;

// SDL reads libc's environment; set it before starting .NET (test-audio.sh).
if (Environment.GetEnvironmentVariable("SDL_AUDIODRIVER") != "dummy" ||
    Environment.GetEnvironmentVariable("SDL_VIDEODRIVER") != "dummy")
    throw new Exception("Run test-audio.sh with SDL's dummy devices");
var privateData = Directory.CreateTempSubdirectory("nel3ab-audio-test-");
Ryujinx.Common.Configuration.AppDataManager.Initialize(privateData.FullName);
using var driver = new SDL2HardwareDeviceDriver();
var failures = new List<string>();
foreach (var (name, test) in new (string, Action)[] {
    ("healthy samples keep their order", Healthy),
    ("a backlog plays the recent samples and releases old buffers", Backlog),
    ("the limit itself does not discard samples", Boundary),
    ("an empty callback outputs silence", Empty),
    ("guest AudioOut keeps its four buffers and its playback clock", GuestOutput),
    ("renderer backlog still discards the same large buffers", RendererLargeBuffers),
}) {
    try { test(); Console.WriteLine($"PASS: {name}"); }
    catch (Exception error) { failures.Add(name); Console.Error.WriteLine($"FAIL: {name}: {error.Message}"); }
}
Directory.Delete(privateData.FullName, recursive: true);
return failures.Count == 0 ? 0 : 1;

IHardwareDeviceSession Session(bool guest = false) => driver.OpenDeviceSession(Direction.Output,
    guest ? new MockVirtualMemoryManager(65536, 4096) : null, SampleFormat.PcmInt16, 48000, 2);
AudioBuffer Queue(IHardwareDeviceSession session, short value, ulong tag, int frames = 240) {
    var samples = Enumerable.Repeat(value, frames * 2).ToArray();
    var data = new byte[frames * 4]; Buffer.BlockCopy(samples, 0, data, 0, data.Length);
    var buffer = new AudioBuffer { DataPointer = tag, Data = data, DataSize = (ulong)data.Length };
    session.QueueBuffer(buffer); return buffer;
}
short[] Read(IHardwareDeviceSession session, int frames = 240) {
    int bytes = frames * 4;
    var output = Marshal.AllocHGlobal(bytes);
    try {
        Marshal.Copy(Enumerable.Repeat((byte)0x7f, bytes).ToArray(), 0, output, bytes);
        var callback = session.GetType().GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new Exception("actual SDL callback is missing");
        callback.Invoke(session, [nint.Zero, output, bytes]);
        var samples = new short[frames * 2]; Marshal.Copy(output, samples, 0, samples.Length); return samples;
    } finally { Marshal.FreeHGlobal(output); }
}
void Equal<T>(T expected, T actual) { if (!EqualityComparer<T>.Default.Equals(expected, actual)) throw new Exception($"expected {expected}, got {actual}"); }
void Tone(short expected, short[] samples) { if (!samples.All(x => x == expected)) throw new Exception($"expected all samples {expected}, first was {samples[0]}"); }
void Healthy() {
    using var session = Session();
    var first = Queue(session, 1000, 1); var second = Queue(session, 2000, 2);
    Tone(1000, Read(session)); Equal(true, session.WasBufferFullyConsumed(first));
    Equal(false, session.WasBufferFullyConsumed(second)); Tone(2000, Read(session));
    Equal(480ul, session.GetPlayedSampleCount());
}
void Backlog() {
    using var session = Session();
    var buffers = Enumerable.Range(0, 120).Select(i => Queue(session, (short)(1000 + i), (ulong)i)).ToArray();
    Tone(1117, Read(session)); // Keep three 5 ms chunks from the accumulated 600 ms.
    Equal(true, session.WasBufferFullyConsumed(buffers[0]));
    Equal(true, session.WasBufferFullyConsumed(buffers[117]));
    Equal(false, session.WasBufferFullyConsumed(buffers[118]));
    Equal(118ul * 240, session.GetPlayedSampleCount());
    Tone(1118, Read(session)); Tone(1119, Read(session));
    Equal(120ul * 240, session.GetPlayedSampleCount()); Tone(0, Read(session));
}
void Boundary() {
    using var session = Session();
    for (int i = 0; i < 10; i++) Queue(session, (short)(1000 + i), (ulong)i);
    Tone(1000, Read(session)); // Exactly 50 ms remains valid.
}
void Empty() { using var session = Session(); Tone(0, Read(session)); Equal(0ul, session.GetPlayedSampleCount()); }

void GuestOutput() {
    // Looney Tunes, 2026-09-09: AudioOut supplies 1024-frame buffers, with up to
    // four registered by AudioDeviceSession. Their 85.33 ms is ordinary queued
    // playback, not an unpaced renderer backlog. Releasing them early makes the
    // guest generate the next sound early too: the sample clock must not jump.
    using var session = Session(guest: true);
    var pending = new Queue<AudioBuffer>();
    for (int i = 0; i < 4; i++) pending.Enqueue(Queue(session, (short)(1000 + i), (ulong)i, 1024));
    for (int i = 0; i < 16; i++) {
        var first = pending.Dequeue();
        Equal(false, session.WasBufferFullyConsumed(first));
        Tone((short)(1000 + i), Read(session, 1024));
        Equal(true, session.WasBufferFullyConsumed(first));
        Equal(false, session.WasBufferFullyConsumed(pending.Peek()));
        Equal((ulong)(i + 1) * 1024, session.GetPlayedSampleCount());
        pending.Enqueue(Queue(session, (short)(1004 + i), (ulong)(i + 4), 1024));
    }
}

void RendererLargeBuffers() {
    using var session = Session();
    var first = Queue(session, 1000, 0, 1024);
    for (int i = 1; i < 4; i++) Queue(session, (short)(1000 + i), (ulong)i, 1024);
    Tone(1003, Read(session, 1024));
    Equal(true, session.WasBufferFullyConsumed(first));
    Equal(4096ul, session.GetPlayedSampleCount());
    Tone(0, Read(session, 1024));
}
