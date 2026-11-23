/**
 * Le réglage des effets rétro au pied de la liste des salles (ADR D37).
 *
 * Le salon n'a pas la page React de la salle: il reçoit ce morceau de page,
 * écrit ici depuis les mêmes mots (`mots.ts`) et la même clé (`effets.ts`),
 * dans `control/.../routes/retro/reglage.html` (`salon-retro.test.ts`). Le
 * script s'appuie sur celui de l'en-tête (`scriptEnTete`), qui pose déjà les
 * classes et laisse `nel3abEffets.appliquer`.
 *
 * Ce module n'est importé par aucune page: il ne part pas dans la salle.
 */
import { CLE, NIVEAU_DEFAUT, NIVEAUX } from "./effets";
import { EFFETS_RETRO } from "./mots";

const echapper = (texte: string) =>
  texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Le formulaire du réglage, son style et son script. */
export function reglageSalonHTML(): string {
  const choix = NIVEAUX.map(
    (id) =>
      `    <label><input type="radio" name="rt-niveau" value="${id}"> <span>${echapper(EFFETS_RETRO.niveaux[id].label)}</span></label>`,
  ).join("\n");
  const notes = JSON.stringify(
    Object.fromEntries(NIVEAUX.map((id) => [id, EFFETS_RETRO.niveaux[id].note])),
  ).replace(/</g, "\\u003c");
  return `<style>
  .rt-reglage { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1.2rem;
                margin: 0; padding: .6rem 0 0; border-top: 2px solid var(--filet);
                color: var(--legende); font-size: clamp(14px, 1.3vw, 16px); }
  .rt-reglage fieldset { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem .9rem;
                         margin: 0; padding: 0; border: 0; }
  .rt-reglage legend { float: left; margin-right: .6rem; padding: 0; color: var(--encre);
                       font-family: var(--police-titre); }
  .rt-reglage label { display: inline-flex; align-items: center; gap: .35rem; min-height: 44px;
                      cursor: pointer; }
  .rt-reglage input { accent-color: var(--signal); width: 1.1rem; height: 1.1rem; margin: 0; }
  .rt-reglage-note { flex-basis: 100%; margin: 0; }
</style>
<form class="rt-reglage" id="rt-reglage">
  <fieldset>
    <legend>${echapper(EFFETS_RETRO.reglage)}</legend>
${choix}
  </fieldset>
  <label><input type="checkbox" name="rt-sons"> <span>${echapper(EFFETS_RETRO.sons)}</span></label>
  <p class="rt-reglage-note" id="rt-reglage-note"></p>
</form>
<script>
(function () {
  var forme = document.getElementById("rt-reglage");
  var note = document.getElementById("rt-reglage-note");
  var notes = ${notes};
  function lire() {
    var r = { niveau: "${NIVEAU_DEFAUT}", sons: false };
    try {
      var lu = JSON.parse(localStorage.getItem("${CLE}") || "null");
      if (lu && typeof lu === "object") {
        if (Object.prototype.hasOwnProperty.call(notes, lu.niveau)) r.niveau = lu.niveau;
        if (lu.sons === true) r.sons = true;
      }
    } catch (refus) {}
    return r;
  }
  function montrer() {
    var r = lire();
    var radios = forme.querySelectorAll('input[name="rt-niveau"]');
    for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === r.niveau;
    forme.querySelector('input[name="rt-sons"]').checked = r.sons;
    note.textContent = notes[r.niveau];
  }
  forme.addEventListener("change", function () {
    var choisi = forme.querySelector('input[name="rt-niveau"]:checked');
    var r = { niveau: choisi ? choisi.value : lire().niveau, sons: forme.querySelector('input[name="rt-sons"]').checked };
    try { localStorage.setItem("${CLE}", JSON.stringify(r)); } catch (refus) {}
    if (window.nel3abEffets) window.nel3abEffets.appliquer();
    montrer();
  });
  forme.addEventListener("submit", function (e) { e.preventDefault(); });
  window.addEventListener("storage", function (e) { if (e.key === "${CLE}" || e.key === null) montrer(); });
  montrer();
})();
</script>
`;
}
