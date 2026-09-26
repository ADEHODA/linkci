// Discussion (site) : messages prives ou de groupe, comme dans l'application :
// reagir, repondre en citant, modifier (15 min), supprimer pour tous, sondages de groupe.
//   const d = LinkCI.discussion({ zone, formulaire, champ, barre, moiId, groupe: true|false, prenomAutre,
//                                charger, envoyer, reagir, modifier, supprimer, voter, peutSupprimer });
//   d.recharger();
(() => {
  const L = window.LinkCI;
  const EMOJIS = ['❤️', '😂', '😮', '😢', '🙏', '👍'];
  const date = (t) => new Date(`${String(t).slice(0, 19).replace(' ', 'T')}Z`);
  const age = (m) => Date.now() - date(m.date_envoi).getTime();
  const extrait = (m) => (m.supprime ? 'Message supprime' : m.contenu || (m.audio ? 'Note vocale' : m.image ? 'Photo' : ''));
  const jour = (t) => date(t).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const heure = (t) => date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  L.discussion = (o) => {
    let messages = [];
    let reponse = null;
    let edition = null;

    const bulle = (m) => {
      const moi = m.user_id === o.moiId || m.expediteur_id === o.moiId;
      const reacs = (m.reactions || []).map((r) =>
        `<button class="disc-reac ${r.moi ? 'moi' : ''}" data-reac="${r.emoji}" data-id="${m.id}">${r.emoji}${r.nb > 1 ? ' ' + r.nb : ''}</button>`).join('');
      const total = (m.sondage || []).reduce((n, x) => n + x.votes, 0);
      const sondage = (m.sondage || []).length ? `<div class="disc-sondage">${m.sondage.map((x) => {
        const pct = total ? Math.round((x.votes * 100) / total) : 0;
        const mien = m.mon_vote === x.id;
        return `<button class="disc-option ${mien ? 'mien' : ''}" data-vote="${x.id}" data-id="${m.id}">
          ${m.mon_vote ? `<i style="width:${pct}%"></i>` : ''}<span>${mien ? '✓ ' : ''}${L.esc(x.texte)}</span>${m.mon_vote ? `<b>${pct} %</b>` : ''}</button>`;
      }).join('')}<small>${total} vote${total > 1 ? 's' : ''}${m.mon_vote ? '' : ' · clique sur un choix pour voter'}</small></div>` : '';
      const auteurCite = m.reponse ? (m.reponse.user_id === o.moiId || m.reponse.expediteur_id === o.moiId ? 'Toi' : L.esc(m.reponse.prenom || o.prenomAutre || '')) : '';
      return `<div class="disc-ligne ${moi ? 'moi' : ''}" id="m${m.id}">
        <div class="disc-bulle" data-id="${m.id}" title="Cliquer pour reagir, repondre...">
          ${o.groupe && !moi ? `<div class="disc-auteur">${L.esc(m.prenom)} ${L.esc(m.nom || '')}</div>` : ''}
          ${m.transfere ? '<div class="disc-petit">↪ Transfere</div>' : ''}
          ${m.story_apercu ? `<div class="disc-citation"><b>🟢 ${moi ? 'Statut' : 'A repondu a ton statut'}</b>${L.esc(m.story_apercu)}</div>` : ''}
          ${m.reponse ? `<div class="disc-citation"><b>${auteurCite}</b>${L.esc(m.reponse.extrait)}</div>` : ''}
          ${m.supprime ? '<em class="disc-petit">🚫 Message supprime</em>' : ''}
          ${m.image ? `<a href="${L.image(m.image)}" target="_blank" rel="noopener"><img src="${L.image(m.image)}" alt="Photo" loading="lazy"></a>` : ''}
          ${m.audio ? `<audio controls preload="none" src="${L.image(m.audio)}"></audio>` : ''}
          ${m.contenu ? `<div class="disc-texte">${(m.sondage || []).length ? '📊 ' : ''}${L.esc(m.contenu)}</div>` : ''}
          ${sondage}
          <div class="disc-meta">${m.modifie ? 'modifie · ' : ''}${heure(m.date_envoi)}${!o.groupe && moi ? (m.lu ? ' ✓✓' : ' ✓') : ''}</div>
        </div>
        ${reacs ? `<div class="disc-reacs">${reacs}</div>` : ''}
      </div>`;
    };

    const dessiner = () => {
      const enBas = o.zone.scrollHeight - o.zone.scrollTop - o.zone.clientHeight < 80;
      let dernier = '';
      o.zone.innerHTML = messages.map((m) => {
        const j = String(m.date_envoi).slice(0, 10);
        const sep = j !== dernier ? `<div class="disc-jour"><span>${jour(m.date_envoi)}</span></div>` : '';
        dernier = j;
        return sep + bulle(m);
      }).join('') || '<div class="disc-vide">👋 Aucun message. Ecris le premier !</div>';
      if (enBas || !o.zone.dataset.vu) { o.zone.scrollTop = o.zone.scrollHeight; o.zone.dataset.vu = '1'; }
      // arrivee depuis la recherche : /conversation/12#m345
      const cible = location.hash && document.getElementById(location.hash.slice(1));
      if (cible && !o.zone.dataset.cible) {
        o.zone.dataset.cible = '1';
        cible.scrollIntoView({ block: 'center' });
        cible.querySelector('.disc-bulle').classList.add('surligne');
      }
    };

    const recharger = async () => {
      try { messages = await o.charger(); dessiner(); } catch (e) { L.erreur(e); }
    };

    const barre = () => {
      const m = edition || reponse;
      o.barre.hidden = !m;
      if (m) {
        o.barre.innerHTML = `<div><b>${edition ? 'Modifier le message' : 'Reponse a ' + ((m.user_id || m.expediteur_id) === o.moiId ? 'toi-meme' : L.esc(m.prenom || o.prenomAutre || ''))}</b>
          <span>${L.esc(extrait(m)).slice(0, 120)}</span></div><button type="button" data-annuler>✕</button>`;
      }
    };
    o.barre.addEventListener('click', (e) => {
      if (!e.target.closest('[data-annuler]')) return;
      if (edition) o.champ.value = '';
      reponse = null; edition = null; barre();
    });

    const menu = (m) => {
      const moi = (m.user_id || m.expediteur_id) === o.moiId;
      const actions = [['repondre', '↩️ Repondre']];
      if (moi && m.contenu && !(m.sondage || []).length && age(m) < 15 * 60 * 1000) actions.push(['modifier', '✏️ Modifier']);
      if (o.peutSupprimer(m)) actions.push(['supprimer', '🗑️ Supprimer pour tout le monde']);
      const f = L.fenetre(`<div class="disc-menu-emojis">${EMOJIS.map((x) => `<button data-emoji="${x}">${x}</button>`).join('')}</div>
        <p class="sous">${L.esc(extrait(m)).slice(0, 140)}</p>
        ${actions.map(([cle, label]) => `<button class="disc-menu-action" data-action="${cle}">${label}</button>`).join('')}`);
      f.el.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        f.fermer();
        try {
          if (b.dataset.emoji) { await o.reagir(m.id, b.dataset.emoji); await recharger(); }
          else if (b.dataset.action === 'repondre') { reponse = m; edition = null; barre(); o.champ.focus(); }
          else if (b.dataset.action === 'modifier') { edition = m; reponse = null; o.champ.value = m.contenu; barre(); o.champ.focus(); }
          else if (b.dataset.action === 'supprimer' && L.confirmer('Supprimer ce message pour tout le monde ?')) { await o.supprimer(m.id); await recharger(); }
        } catch (err) { L.erreur(err); }
      });
    };

    o.zone.addEventListener('click', async (e) => {
      if (e.target.closest('a, audio')) return;
      const r = e.target.closest('[data-reac]');
      const v = e.target.closest('[data-vote]');
      try {
        if (r) { await o.reagir(Number(r.dataset.id), r.dataset.reac); return recharger(); }
        if (v) { await o.voter(Number(v.dataset.id), Number(v.dataset.vote)); return recharger(); }
      } catch (err) { return L.erreur(err); }
      const b = e.target.closest('.disc-bulle');
      if (!b) return;
      const m = messages.find((x) => x.id === Number(b.dataset.id));
      if (m && !m.supprime) menu(m);
    });

    o.formulaire.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contenu = o.champ.value.trim();
      if (!contenu) return;
      o.champ.value = '';
      try {
        if (edition) await o.modifier(edition.id, contenu);
        else await o.envoyer(contenu, reponse ? reponse.id : null);
      } catch (err) { o.champ.value = contenu; L.erreur(err); return; }
      reponse = null; edition = null; barre();
      o.zone.dataset.vu = '';
      await recharger();
    });

    recharger();
    return { recharger };
  };
})();
