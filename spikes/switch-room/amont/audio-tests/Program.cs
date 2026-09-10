// Exercise the actual SDL3 session against SDL's dummy device. Keep it paused
// and invoke its real callback explicitly, so a slow CI machine cannot drain
// the deliberately queued samples before the assertion. The SDL3 callback does
// not fill a caller buffer: it puts bytes into the SDL audio stream it is given.
// Each read hands it a real stream with no device behind it, then takes the
// bytes back out of that stream.
using System.Reflection;
using System.Runtime.InteropServices;
using Ryujinx.Audio.Backends.SDL3;
using Ryujinx.Audio.Common;
using Ryujinx.Audio.Integration;
using Ryujinx.Tests.Memory;
using SDL;
using static SDL.SDL3;
using static Ryujinx.Audio.Integration.IHardwareDeviceDriver;

// SDL reads libc's environment; set it before starting .NET (test-audio.sh).
// SDL3 renamed the variables to SDL_AUDIO_DRIVER and SDL_VIDEO_DRIVER.
if (Environment.GetEnvironmentVariable("SDL_AUDIO_DRIVER") != "dummy" ||
    Environment.GetEnvironmentVariable("SDL_VIDEO_DRIVER") != "dummy")
    throw new Exception("Run test-audio.sh with SDL's dummy devices");
var privateData = Directory.CreateTempSubdirectory("nel3ab-audio-test-");
Ryujinx.Common.Configuration.AppDataManager.Initialize(privateData.FullName);
using var driver = new SDL3HardwareDeviceDriver();
// Ask SDL which drivers it started instead of trusting the variable names.
if (SDL_GetCurrentAudioDriver() != "dummy" || SDL_GetCurrentVideoDriver() != "dummy")
    throw new Exception($"SDL started {SDL_GetCurrentAudioDriver()} audio and {SDL_GetCurrentVideoDriver()} video, not dummy");
var failures = new List<string>();
foreach (var (name, test) in new (string, Action)[] {
    ("healthy samples keep their order", Healthy),
    ("a backlog plays the recent samples and releases old buffers", Backlog),
    ("the limit itself does not discard samples", Boundary),
    ("an empty callback outputs silence", Empty),
    ("guest AudioOut keeps its four buffers and its playback clock", GuestOutput),
    ("renderer backlog still discards the same large buffers", RendererLargeBuffers),
    ("a single guest buffer leaves in one piece, as with SDL2's per-session period", GuestSingleBuffer),
    ("SDL itself pulls 5 ms at a time, and no more than one period waits ahead", DevicePull),
    ("the probe line never asks SDL while holding the queue lock", ProbeLockOrder),
}) {
    try { test(); Console.WriteLine($"PASS: {name}"); }
    catch (Exception error) { failures.Add(name); Console.Error.WriteLine($"FAIL: {name}: {(error as TargetInvocationException)?.InnerException?.Message ?? error.Message}"); }
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
// Run one callback that asks for `frames`, and return every byte it put.
unsafe byte[] Callback(IHardwareDeviceSession session, int frames) {
    int bytes = frames * 4;
    var spec = new SDL_AudioSpec { format = SDL_AudioFormat.SDL_AUDIO_S16LE, channels = 2, freq = 48000 };
    SDL_AudioStream* stream = SDL_CreateAudioStream(&spec, &spec);
    if (stream == null) throw new Exception($"SDL_CreateAudioStream failed: {SDL_GetError()}");
    try {
        var callback = session.GetType().GetMethod("Update", BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new Exception("actual SDL callback is missing");
        callback.Invoke(session, [nint.Zero, Pointer.Box(stream, typeof(SDL_AudioStream*)), bytes, bytes]);
        // Everything the callback put, which may be more than SDL asked for: a
        // session hands over its own period, as SDL2 did (GuestSingleBuffer).
        // Each test states the exact count it expects.
        int available = SDL_GetAudioStreamAvailable(stream);
        if (available < 0) throw new Exception($"SDL_GetAudioStreamAvailable failed: {SDL_GetError()}");
        var output = new byte[available]; int got = 0;
        if (available > 0) fixed (byte* pointer = output) got = SDL_GetAudioStreamData(stream, (nint)pointer, available);
        if (got < 0) throw new Exception($"SDL_GetAudioStreamData failed: {SDL_GetError()}");
        Equal(available, got);
        return output;
    } finally { SDL_DestroyAudioStream(stream); }
}
short[] Read(IHardwareDeviceSession session, int frames = 240) {
    var data = Callback(session, frames);
    Equal(frames * 4, data.Length);
    var samples = new short[frames * 2]; Buffer.BlockCopy(data, 0, samples, 0, data.Length); return samples;
}
// With nothing queued, the callback returns without putting any bytes, and
// SDL3's device loop pads a short stream with silence. Putting a full buffer of
// zeros would sound the same, so both are accepted; any other count or any
// non-zero byte is not.
void Silence(IHardwareDeviceSession session, int frames = 240) {
    var data = Callback(session, frames);
    if (data.Length != 0) Equal(frames * 4, data.Length);
    if (data.Any(x => x != 0)) throw new Exception("expected silence, got non-zero samples");
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
    Equal(120ul * 240, session.GetPlayedSampleCount()); Silence(session);
}
void Boundary() {
    using var session = Session();
    for (int i = 0; i < 10; i++) Queue(session, (short)(1000 + i), (ulong)i);
    Tone(1000, Read(session)); // Exactly 50 ms remains valid.
}
void Empty() { using var session = Session(); Silence(session); Equal(0ul, session.GetPlayedSampleCount()); }

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

void GuestSingleBuffer() {
    // The test program (guest/nel3ab-probe.nro), 2026-09-10: one 960-frame
    // AudioOut buffer at a time, refilled only once released. SDL2 opened one
    // device per session with a 960-frame period, so the whole buffer left at
    // once and the guest had 20 ms to refill. SDL3 shares one device that asks
    // in 5 ms chunks: handing over 240 frames left the guest 5 ms, and the room
    // heard a 5 ms silence every 60 to 80 ms (277 in 20 s; 0 on SDL2).
    using var session = Session(guest: true);
    var only = Queue(session, 1000, 1, 960);
    var data = Callback(session, 240);
    Equal(960 * 4, data.Length);
    var samples = new short[960 * 2]; Buffer.BlockCopy(data, 0, samples, 0, data.Length); Tone(1000, samples);
    Equal(true, session.WasBufferFullyConsumed(only));
    Equal(960ul, session.GetPlayedSampleCount());
    Silence(session);
}

unsafe void DevicePull() {
    // SDL3 calls the get callback on every read of a device stream, with
    // additional_amount the bytes the stream lacks: zero when an earlier period
    // left enough. The other tests call Update by hand; here SDL drives it, as
    // the device does, 240 frames per read. Handing a period over on the zero
    // calls too drained the guest as fast as SDL asked: the game produced
    // faster than real time and the SDL stream grew without bound. Looney
    // Tunes played its intro silence for minutes in the room (2026-09-10).
    using var session = Session(guest: true);
    for (int i = 0; i < 4; i++) Queue(session, (short)(1000 + i), (ulong)i, 1024);
    var spec = new SDL_AudioSpec { format = SDL_AudioFormat.SDL_AUDIO_S16LE, channels = 2, freq = 48000 };
    SDL_AudioStream* stream = SDL_CreateAudioStream(&spec, &spec);
    if (stream == null) throw new Exception($"SDL_CreateAudioStream failed: {SDL_GetError()}");
    try {
        var callback = (Delegate)(session.GetType().GetField("_callbackDelegate", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(session)
            ?? throw new Exception("actual SDL callback delegate is missing"));
        var pointer = (delegate* unmanaged[Cdecl]<nint, SDL_AudioStream*, int, int, void>)Marshal.GetFunctionPointerForDelegate(callback);
        SDL_SetAudioStreamGetCallback(stream, pointer, 0);
        var chunk = new byte[240 * 4];
        for (int read = 0; read < 8; read++) {
            int got; fixed (byte* at = chunk) got = SDL_GetAudioStreamData(stream, (nint)at, chunk.Length);
            Equal(chunk.Length, got);
            if (read == 0) { var first = new short[240 * 2]; Buffer.BlockCopy(chunk, 0, first, 0, chunk.Length); Tone(1000, first); }
        }
        // 1920 frames read. At most one 1024-frame period, plus the read that
        // asked for it, may have been handed over ahead of them.
        ulong played = session.GetPlayedSampleCount();
        if (played > 1920 + 1024 + 240) throw new Exception($"{played} frames handed over for 1920 read: the SDL stream grows without bound");
        int ahead = SDL_GetAudioStreamAvailable(stream) / 4;
        if (ahead > 1024 + 240) throw new Exception($"{ahead} frames wait in the SDL stream");
    } finally { SDL_DestroyAudioStream(stream); }
}

unsafe void ProbeLockOrder() {
    // SDL calls Update holding its stream lock, and Update takes the queue
    // lock. The probe line of QueueBuffer asked SDL for its backlog while
    // holding the queue lock: the opposite order. On 2026-09-10 the test
    // program's audio thread froze at its first buffer that way, and the probe
    // could only be stopped by force. Here one thread holds the SDL stream lock,
    // as SDL does during a callback, and QueueBuffer runs on another: the queue
    // lock must stay free for the callback that SDL would be running.
    Environment.SetEnvironmentVariable("NEL3AB_AUDIO_PROBE", "1");
    try {
        using var session = Session(guest: true);
        Queue(session, 1000, 1, 960);
        var type = session.GetType();
        var queueLock = type.GetField("_queueLock", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(session) ?? throw new Exception("queue lock is missing");
        var output = (SDL_AudioStream*)Pointer.Unbox(type.GetField("_outputStream", BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(session) ?? throw new Exception("output stream is missing"));
        type.GetField("_nextProbe", BindingFlags.Instance | BindingFlags.NonPublic)?.SetValue(session, 0L);
        SDL_LockAudioStream(output);
        var queued = new Thread(() => Queue(session, 1001, 2, 960));
        try {
            queued.Start();
            Thread.Sleep(200);
            if (!Monitor.TryEnter(queueLock, 1000)) throw new Exception("QueueBuffer holds the queue lock while waiting for SDL: a callback would deadlock");
            Monitor.Exit(queueLock);
        } finally { SDL_UnlockAudioStream(output); }
        if (!queued.Join(5000)) throw new Exception("QueueBuffer never finished");
    } finally { Environment.SetEnvironmentVariable("NEL3AB_AUDIO_PROBE", null); }
}

void RendererLargeBuffers() {
    using var session = Session();
    var first = Queue(session, 1000, 0, 1024);
    for (int i = 1; i < 4; i++) Queue(session, (short)(1000 + i), (ulong)i, 1024);
    Tone(1003, Read(session, 1024));
    Equal(true, session.WasBufferFullyConsumed(first));
    Equal(4096ul, session.GetPlayedSampleCount());
    Silence(session, 1024);
}
