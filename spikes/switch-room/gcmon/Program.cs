// gcmon : chaque suspension du runtime .NET d'un émulateur, et ses nettoyages.
//
// gcmon DUREE_S [PREMIER_INDUIT_S PERIODE_INDUIT_S]    (lignes JSON sur stdout)
//
// Il tourne DANS le conteneur de l'émulateur (docker exec) : la prise de
// diagnostic par défaut du runtime est dans le /tmp du conteneur, et le seul
// processus .NET qui l'a publiée est l'émulateur. Aucun réglage n'est ajouté à
// l'émulateur pour le suivre.
//
// Une session EventPipe, mot-clé GC (0x1) au niveau Informational, donne pour
// chaque nettoyage son début, sa fin, sa génération, son type et sa raison, et
// pour chaque arrêt du processus (GCSuspendEEBegin → GCRestartEEEnd) sa durée.
// C'est cette durée que voit un joueur : tous les fils gérés sont arrêtés.
//
// Avec PERIODE_INDUIT_S > 0, une seconde session s'ouvre à intervalles réguliers
// avec le seul mot-clé ManagedHeapCollect (0x800000) : à son ouverture, le
// runtime fait un nettoyage complet et bloquant (eventtrace.cpp, bValidGCRequest
// → ForceGCForDiagnostics → GarbageCollect(-1, false, collection_blocking)),
// sans parcourir le tas (il faudrait GCHeapDump, 0x100000, qui n'est pas demandé).
using System.Diagnostics.Tracing;
using System.Text.Json;
using Microsoft.Diagnostics.NETCore.Client;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers;
using Microsoft.Diagnostics.Tracing.Parsers.Clr;

if (args.Length < 1)
{
    Console.Error.WriteLine("gcmon DUREE_S [PREMIER_INDUIT_S PERIODE_INDUIT_S]");
    return 2;
}
var inv = System.Globalization.CultureInfo.InvariantCulture;
double duree = double.Parse(args[0], inv);
double premier = args.Length > 2 ? double.Parse(args[1], inv) : 0;
double periode = args.Length > 2 ? double.Parse(args[2], inv) : 0;

var verrou = new object();
var fichier = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
void Ecrire(Dictionary<string, object?> ligne)
{
    lock (verrou) { fichier.WriteLine(JsonSerializer.Serialize(ligne)); }
}
string Maintenant() => DateTime.UtcNow.ToString("o");

// Un seul processus .NET publié, hormis celui-ci : sinon on ne sait pas lequel suivre.
var moi = Environment.ProcessId;
var publies = DiagnosticsClient.GetPublishedProcesses().Where(p => p != moi).ToList();
if (publies.Count != 1)
{
    Ecrire(new() { ["evt"] = "refus", ["t"] = Maintenant(), ["publies"] = publies });
    return 3;
}
var info = new { ProcessId = publies[0] };
var client = new DiagnosticsClient(info.ProcessId);
var env = client.GetProcessEnvironment();
var gcEnv = env.Where(kv => kv.Key.StartsWith("DOTNET_", StringComparison.Ordinal))
    .ToDictionary(kv => kv.Key, kv => (object?)kv.Value);
Ecrire(new() { ["evt"] = "connexion", ["t"] = Maintenant(), ["pid"] = info.ProcessId, ["env"] = gcEnv });

var fournisseur = new EventPipeProvider("Microsoft-Windows-DotNETRuntime", EventLevel.Informational,
    (long)ClrTraceEventParser.Keywords.GC);
var session = client.StartEventPipeSession(new[] { fournisseur }, requestRundown: false, circularBufferMB: 64);
var source = new EventPipeEventSource(session.EventStream);
double? suspendu = null;
string T(TraceEvent e) => e.TimeStamp.ToUniversalTime().ToString("o");

source.Clr.GCSuspendEEStart += e =>
{
    suspendu = e.TimeStampRelativeMSec;
    Ecrire(new() { ["evt"] = "suspend", ["t"] = T(e), ["raison"] = e.Reason.ToString(), ["n"] = e.Count });
};
source.Clr.GCRestartEEStop += e =>
{
    Ecrire(new()
    {
        ["evt"] = "reprise",
        ["t"] = T(e),
        ["pause_ms"] = suspendu is double s ? Math.Round(e.TimeStampRelativeMSec - s, 3) : null,
    });
    suspendu = null;
};
source.Clr.GCStart += e => Ecrire(new()
{
    ["evt"] = "debut",
    ["t"] = T(e),
    ["n"] = e.Count,
    ["gen"] = e.Depth,
    ["type"] = e.Type.ToString(),
    ["raison"] = e.Reason.ToString(),
});
source.Clr.GCStop += e => Ecrire(new() { ["evt"] = "fin", ["t"] = T(e), ["n"] = e.Count, ["gen"] = e.Depth });
source.Clr.GCHeapStats += e => Ecrire(new()
{
    ["evt"] = "tas",
    ["t"] = T(e),
    ["gen0_mo"] = e.GenerationSize0 / 1e6,
    ["gen1_mo"] = e.GenerationSize1 / 1e6,
    ["gen2_mo"] = e.GenerationSize2 / 1e6,
    ["loh_mo"] = e.GenerationSize3 / 1e6,
    ["poh_mo"] = e.GenerationSize4 / 1e6,
    ["promus_mo"] = e.TotalPromotedSize0 / 1e6 + e.TotalPromotedSize1 / 1e6 + e.TotalPromotedSize2 / 1e6
        + e.TotalPromotedSize3 / 1e6 + e.TotalPromotedSize4 / 1e6,
});
source.Clr.GCGlobalHeapHistory += e => Ecrire(new()
{
    ["evt"] = "histoire",
    ["t"] = T(e),
    ["tas"] = e.NumHeaps,
    ["condamnee"] = e.CondemnedGeneration,
    ["mecanismes"] = e.GlobalMechanisms.ToString(),
    ["mode"] = e.PauseMode.ToString(),
});
var lecteur = Task.Run(() => source.Process());

using var fin = new CancellationTokenSource(TimeSpan.FromSeconds(duree));
if (periode > 0)
{
    try
    {
        await Task.Delay(TimeSpan.FromSeconds(premier), fin.Token);
        while (!fin.IsCancellationRequested)
        {
            var collecte = new EventPipeProvider("Microsoft-Windows-DotNETRuntime", EventLevel.Informational, 0x800000);
            Ecrire(new() { ["evt"] = "induit", ["t"] = Maintenant() });
            var s2 = client.StartEventPipeSession(new[] { collecte }, requestRundown: false, circularBufferMB: 16);
            // La session doit être lue pour se fermer proprement.
            var vidange = Task.Run(() => { try { s2.EventStream.CopyTo(Stream.Null); } catch (Exception) { } });
            await Task.Delay(TimeSpan.FromSeconds(2));
            s2.Stop();
            await vidange.WaitAsync(TimeSpan.FromSeconds(10));
            s2.Dispose();
            await Task.Delay(TimeSpan.FromSeconds(periode - 2), fin.Token);
        }
    }
    catch (TaskCanceledException) { }
}
else
{
    try { await Task.Delay(Timeout.Infinite, fin.Token); } catch (TaskCanceledException) { }
}
Ecrire(new() { ["evt"] = "arret", ["t"] = Maintenant() });
try { session.Stop(); } catch (Exception ex) { Ecrire(new() { ["evt"] = "erreur_arret", ["message"] = ex.Message }); }
await lecteur.WaitAsync(TimeSpan.FromSeconds(30));
return 0;
