/* LinkCI - interface web : utilise la meme API que l'app mobile.
   Les appels portent l'en-tete X-LinkCI (le serveur accepte alors la session du navigateur). */
(function () {
  'use strict';

  const L = (window.LinkCI = {});

  // ---------------------------------------------------------------- outils
  L.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  L.api = async (chemin, options = {}) => {
    const init = { method: options.methode || 'GET', credentials: 'same-origin', headers: { 'X-LinkCI': 'web' } };
    if (options.corps !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.corps);
    }
    let res;
    try { res = await fetch(chemin, init); } catch (e) { throw new Error('Pas de connexion internet'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { window.location = '/connexion'; throw new Error('Session expiree'); }
    if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
    return data;
  };

  L.toast = (texte) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = texte;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  };

  L.erreur = (e) => L.toast(e && e.message ? e.message : String(e));

  const COULEURS = ['#FF6B35', '#7C3AED', '#059669', '#DC2626', '#2563EB', '#D97706', '#DB2777', '#0891B2', '#65A30D', '#9333EA'];
  L.avatar = (nom, index, avatar, taille = 40) => {
    const style = `width:${taille}px;height:${taille}px;font-size:${Math.round(taille * 0.38)}px`;
    if (avatar && avatar !== 'default.png') return `<img class="av" style="${style}" src="/static/avatars/${L.esc(avatar)}" alt="">`;
    const initiales = String(nom || '?').trim().split(/\s+/).map((m) => m[0]).slice(0, 2).join('').toUpperCase();
    return `<span class="av" style="${style};background:${COULEURS[(index || 0) % COULEURS.length]}">${L.esc(initiales)}</span>`;
  };

  L.image = (nom) => `/static/uploads/${encodeURIComponent(nom)}`;

  // "il y a 5 min", "hier", "12 mars"
  L.quand = (texte) => {
    if (!texte) return '';
    const d = new Date(String(texte).replace(' ', 'T') + (String(texte).length <= 19 ? 'Z' : ''));
    if (isNaN(d)) return '';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 60) return "a l'instant";
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
    if (s < 172800) return 'hier';
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };

  // Photo choisie -> JPEG base64 redimensionne (1280 px max), comme l'app
  L.photoEnBase64 = (fichier, max = 1280) => new Promise((ok, ko) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => ko(new Error('Photo illisible'));
    lecteur.onload = () => {
      const img = new Image();
      img.onerror = () => ko(new Error('Photo illisible'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.src = lecteur.result;
    };
    lecteur.readAsDataURL(fichier);
  });

  L.choisirPhoto = () => new Promise((ok) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    i.onchange = () => ok(i.files[0] || null);
    i.click();
  });

  // Fenetre simple : renvoie { el, fermer }
  L.fenetre = (html) => {
    const fond = document.createElement('div');
    fond.className = 'fond';
    fond.innerHTML = `<div class="fenetre">${html}</div>`;
    const fermer = () => fond.remove();
    fond.addEventListener('click', (e) => { if (e.target === fond || e.target.closest('[data-fermer]')) fermer(); });
    document.body.appendChild(fond);
    return { el: fond.querySelector('.fenetre'), fermer };
  };

  L.confirmer = (texte) => window.confirm(texte);

  let moi = null;
  L.moi = async () => (moi = moi || (await L.api('/api/me')));

  // ---------------------------------------------------------------- theme et pastilles
  document.getElementById('bouton-theme')?.addEventListener('click', () => {
    const racine = document.documentElement;
    const sombre = racine.getAttribute('data-theme') === 'dark'
      || (!racine.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const suivant = sombre ? 'light' : 'dark';
    racine.setAttribute('data-theme', suivant);
    try { localStorage.setItem('linkci_theme', suivant); } catch (e) {}
  });

  const pastille = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n > 99 ? '99+' : n;
    el.style.display = n ? 'flex' : 'none';
  };
  const compteurs = () => L.api('/api/compteurs').then((c) => { pastille('nb-messages', c.messages); pastille('nb-notifs', c.notifications); }).catch(() => {});
  if (document.getElementById('nb-messages')) { compteurs(); setInterval(compteurs, 60000); }

  // ---------------------------------------------------------------- publications
  const EMOJIS = ['🔥', '😂', '👏', '😮', '😢'];

  // Texte d'une publication : echappe, les #hashtags deviennent des liens (decoupe AVANT d'echapper)
  L.texteRiche = (t) => String(t).split(/(#[A-Za-z0-9_À-ÖØ-öø-ÿ]{2,40})/).map((m, k) => (k % 2
    ? `<a href="/fil?tag=${encodeURIComponent(m.slice(1))}" style="color:var(--primary);font-weight:700">${L.esc(m)}</a>`
    : L.esc(m))).join('');

  L.htmlPost = (p) => {
    const reacs = Object.entries(p.reactions || {}).map(([e, n]) =>
      `<button class="reac ${p.ma_reaction === e ? 'moi' : ''}" data-reac="${e}">${e} ${n}</button>`).join('');
    const total = (p.sondage || []).reduce((n, o) => n + o.votes, 0);
    const sondage = (p.sondage || []).length ? `<div class="sondage">${p.sondage.map((o) => {
      const pct = total ? Math.round((o.votes * 100) / total) : 0;
      const m = p.mon_vote === o.id;
      return `<button class="option ${m ? 'moi' : ''}" data-vote="${o.id}">
        ${p.mon_vote ? `<i class="barre" style="width:${pct}%"></i>` : ''}<span>${m ? '✓ ' : ''}${L.esc(o.texte)}</span>
        ${p.mon_vote ? `<span class="pct">${pct} %</span>` : ''}</button>`;
    }).join('')}<div class="sous">${total} vote${total > 1 ? 's' : ''}${p.mon_vote ? '' : ' · clique sur un choix pour voter'}</div></div>` : '';
    return `<article class="carte post" data-id="${p.id}" data-auteur="${p.user_id}">
      <div class="post-haut">
        <a href="/profil/${p.user_id}">${L.avatar(`${p.prenom} ${p.nom}`, p.user_id, p.avatar, 42)}</a>
        <div><a class="post-nom" href="/profil/${p.user_id}" style="color:var(--text)">${L.esc(p.prenom)} ${L.esc(p.nom)}</a>
          <div class="sous">${L.esc([p.universite, L.quand(p.date_post)].filter(Boolean).join(' · '))}</div></div>
        <div class="menu-post"><button class="act" data-menu>⋯</button></div>
      </div>
      ${p.contenu ? `<p class="post-texte">${L.texteRiche(p.contenu)}</p>` : ''}
      ${p.image ? `<img class="post-img" src="${L.image(p.image)}" alt="" loading="lazy" data-zoom>` : ''}
      ${sondage}
      <div class="reactions">${reacs}</div>
      <div class="actions">
        <button class="act like ${p.a_like ? 'on' : ''}" data-like>❤️ <span>${p.nb_likes || 0}</span></button>
        <button class="act" data-choix-reac>${p.ma_reaction || '😊'}</button>
        <button class="act" data-comms>💬 <span>${p.nb_commentaires || 0}</span></button>
        <span style="flex:1"></span>
        <button class="act" data-partager title="Partager">📤</button>
        <button class="act ${p.enregistre ? 'on' : ''}" data-enregistrer title="${p.enregistre ? 'Retirer des enregistrements' : 'Enregistrer pour plus tard'}">${p.enregistre ? '🔖' : '📑'}</button>
      </div>
      <div class="zone-reac"></div>
      <div class="commentaires" hidden></div>
    </article>`;
  };

  // Branche les actions de toutes les publications d'un conteneur (delegation)
  L.brancherPosts = (conteneur, { surSuppression } = {}) => {
    const donnees = new Map(); // id -> publication
    L.enregistrerPosts = (liste) => liste.forEach((p) => donnees.set(String(p.id), p));

    const remplacer = (article, p) => {
      donnees.set(String(p.id), p);
      const tmp = document.createElement('div');
      tmp.innerHTML = L.htmlPost(p);
      article.replaceWith(tmp.firstElementChild);
    };

    conteneur.addEventListener('click', async (e) => {
      const article = e.target.closest('.post');
      if (!article) return;
      const id = article.dataset.id;
      const p = donnees.get(id) || {};
      const cible = e.target.closest('button, img');
      if (!cible) return;
      try {
        if (cible.hasAttribute('data-like')) {
          const r = await L.api(`/api/posts/${id}/like`, { methode: 'POST' });
          remplacer(article, { ...p, a_like: r.liked, nb_likes: r.nb_likes });
        } else if (cible.hasAttribute('data-choix-reac')) {
          const zone = article.querySelector('.zone-reac');
          zone.innerHTML = zone.innerHTML ? '' : `<div class="choix-reac">${EMOJIS.map((x) => `<button data-reac="${x}">${x}</button>`).join('')}</div>`;
        } else if (cible.dataset.reac) {
          const r = await L.api(`/api/posts/${id}/reaction`, { methode: 'POST', corps: { emoji: cible.dataset.reac } });
          remplacer(article, { ...p, reactions: r.reactions, ma_reaction: r.ma_reaction });
        } else if (cible.dataset.vote) {
          const r = await L.api(`/api/posts/${id}/vote`, { methode: 'POST', corps: { option_id: Number(cible.dataset.vote) } });
          remplacer(article, { ...p, sondage: r.sondage, mon_vote: r.mon_vote });
        } else if (cible.hasAttribute('data-zoom')) {
          window.open(cible.src, '_blank');
        } else if (cible.hasAttribute('data-comms')) {
          const zone = article.querySelector('.commentaires');
          if (!zone.hidden) { zone.hidden = true; return; }
          zone.hidden = false;
          await chargerComms(zone, id);
        } else if (cible.hasAttribute('data-enregistrer')) {
          const r = await L.api(`/api/posts/${id}/enregistrer`, { methode: p.enregistre ? 'DELETE' : 'POST' });
          remplacer(article, { ...p, enregistre: r.enregistre });
          L.toast(r.enregistre ? 'Enregistre (Fil > Enregistres)' : 'Retire des enregistrements');
        } else if (cible.hasAttribute('data-partager')) {
          const lien = `${location.origin}/fil#post-${id}`;
          const texte = `${p.prenom} ${p.nom} sur LinkCI : ${(p.contenu || 'Une photo').slice(0, 200)}`;
          if (navigator.share) await navigator.share({ title: 'LinkCI', text: texte, url: lien }).catch(() => {});
          else window.open(`https://wa.me/?text=${encodeURIComponent(texte + '\n' + lien)}`, '_blank', 'noopener');
        } else if (cible.hasAttribute('data-menu')) {
          ouvrirMenu(article, p);
        }
      } catch (err) { L.erreur(err); }
    });

    const chargerComms = async (zone, id) => {
      zone.innerHTML = '<div class="chargement">...</div>';
      const liste = await L.api(`/api/posts/${id}/comments`);
      zone.innerHTML = liste.map((c) => `<div class="comm">${L.avatar(`${c.prenom} ${c.nom}`, c.user_id, c.avatar, 30)}
        <div class="bulle"><a href="/profil/${c.user_id}" style="font-weight:700;color:var(--text)">${L.esc(c.prenom)} ${L.esc(c.nom)}</a>
        <div>${L.esc(c.contenu)}</div></div></div>`).join('')
        + `<form class="ligne" data-commenter><input class="champ" name="t" placeholder="Ecrire un commentaire..." maxlength="1000" required>
           <button class="btn petit">Envoyer</button></form>`;
      zone.querySelector('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const champ = e.target.t;
        try {
          await L.api(`/api/posts/${id}/comments`, { methode: 'POST', corps: { contenu: champ.value.trim() } });
          await chargerComms(zone, id);
          const n = zone.closest('.post').querySelector('[data-comms] span');
          n.textContent = zone.querySelectorAll('.comm').length;
        } catch (err) { L.erreur(err); }
      });
    };

    const ouvrirMenu = async (article, p) => {
      document.querySelectorAll('.menu-post .liste').forEach((x) => x.remove());
      const m = await L.moi();
      const liste = document.createElement('div');
      liste.className = 'liste';
      liste.innerHTML = p.user_id === m.id
        ? '<button data-a="supprimer">🗑️ Supprimer la publication</button>'
        : `<button data-a="signaler">🚩 Signaler la publication</button><button data-a="bloquer">🚫 Bloquer ${L.esc(p.prenom)}</button>`;
      article.querySelector('.menu-post').appendChild(liste);
      liste.addEventListener('click', async (e) => {
        const a = e.target.dataset.a;
        liste.remove();
        try {
          if (a === 'supprimer' && L.confirmer('Supprimer cette publication ?')) {
            await L.api(`/api/posts/${p.id}`, { methode: 'DELETE' });
            article.remove();
            if (surSuppression) surSuppression(p);
          } else if (a === 'signaler') {
            const motif = window.prompt('Pourquoi signaler cette publication ? (spam, arnaque, contenu choquant...)');
            if (motif !== null) L.toast((await L.api(`/api/posts/${p.id}/signaler`, { methode: 'POST', corps: { motif } })).message);
          } else if (a === 'bloquer' && L.confirmer(`Bloquer ${p.prenom} ? Vous ne verrez plus vos publications et ne pourrez plus vous ecrire.`)) {
            await L.api(`/api/utilisateurs/${p.user_id}/bloquer`, { methode: 'POST' });
            conteneur.querySelectorAll(`.post[data-auteur="${p.user_id}"]`).forEach((x) => x.remove());
            L.toast(`${p.prenom} est bloque`);
          }
        } catch (err) { L.erreur(err); }
      });
    };
  };

  // ---------------------------------------------------------------- stories
  L.stories = async (conteneur) => {
    const m = await L.moi();
    const groupes = await L.api('/api/stories').catch(() => []);
    const miennes = groupes.find((g) => g.est_moi);
    const bouton = (g, texte) => `<button class="story" data-g="${g ? groupes.indexOf(g) : ''}">
      <span class="anneau ${g ? '' : 'vide'}">${L.avatar(g ? `${g.prenom} ${g.nom}` : `${m.prenom} ${m.nom}`, g ? g.user_id : m.id, g ? g.avatar : m.avatar, 56)}</span>${L.esc(texte)}</button>`;
    conteneur.innerHTML = bouton(miennes, 'Ma story') + groupes.filter((g) => !g.est_moi).map((g) => bouton(g, g.prenom)).join('');
    conteneur.onclick = async (e) => {
      const b = e.target.closest('.story');
      if (!b) return;
      if (b.dataset.g === '') return nouvelleStory(conteneur);
      lecteur(groupes, Number(b.dataset.g), () => L.stories(conteneur), conteneur);
    };
  };

  const nouvelleStory = async (conteneur) => {
    const fichier = await L.choisirPhoto();
    if (!fichier) return;
    const f = L.fenetre(`<h3>Nouvelle story (24 h)</h3><img id="apercu" style="border-radius:12px;max-height:50vh;width:100%;object-fit:contain;background:#000">
      <input class="champ" id="texte" maxlength="150" placeholder="Texte (optionnel)" style="margin:10px 0">
      <div class="ligne"><button class="btn gris" data-fermer>Annuler</button><button class="btn" id="publier" style="margin-left:auto">Publier</button></div>`);
    f.el.querySelector('#apercu').src = URL.createObjectURL(fichier);
    f.el.querySelector('#publier').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await L.api('/api/stories', { methode: 'POST', corps: { image: await L.photoEnBase64(fichier), texte: f.el.querySelector('#texte').value.trim() } });
        f.fermer();
        L.toast('Story publiee pour 24 h');
        L.stories(conteneur);
      } catch (err) { e.target.disabled = false; L.erreur(err); }
    };
  };

  const lecteur = (groupes, depart, apresFermeture) => {
    let g = depart;
    let i = 0;
    let minuterie = null;
    const v = document.createElement('div');
    v.className = 'visionneuse';
    document.body.appendChild(v);
    const fermer = () => { clearTimeout(minuterie); v.remove(); apresFermeture(); };
    const afficher = () => {
      const groupe = groupes[g];
      const s = groupe.stories[i];
      v.innerHTML = `<div class="barres">${groupe.stories.map((x, k) => `<div><i style="width:${k < i ? 100 : 0}%"></i></div>`).join('')}</div>
        <div class="vis-haut">${L.avatar(`${groupe.prenom} ${groupe.nom}`, groupe.user_id, groupe.avatar, 34)}
          <strong>${groupe.est_moi ? 'Ma story' : L.esc(groupe.prenom)}</strong><span style="opacity:.7">${L.quand(s.date_creation)}</span>
          ${groupe.est_moi ? '<button data-suppr title="Supprimer" style="margin-left:auto;font-size:20px">🗑️</button>' : ''}<button data-fermer>✕</button></div>
        <img src="${L.image(s.image)}" alt="">${s.texte ? `<div class="legende">${L.esc(s.texte)}</div>` : ''}`;
      const barre = v.querySelectorAll('.barres i')[i];
      requestAnimationFrame(() => { barre.style.transition = 'width 5s linear'; barre.style.width = '100%'; });
      clearTimeout(minuterie);
      minuterie = setTimeout(suivante, 5000);
    };
    const suivante = () => {
      if (i + 1 < groupes[g].stories.length) i += 1;
      else if (g + 1 < groupes.length) { g += 1; i = 0; } else return fermer();
      afficher();
    };
    v.addEventListener('click', async (e) => {
      if (e.target.closest('[data-fermer]')) return fermer();
      if (e.target.closest('[data-suppr]')) {
        if (!L.confirmer('Supprimer cette story ?')) return;
        try { await L.api(`/api/stories/${groupes[g].stories[i].id}`, { methode: 'DELETE' }); } catch (err) { L.erreur(err); }
        return fermer();
      }
      if (e.clientX < window.innerWidth / 3) { if (i > 0) i -= 1; else if (g > 0) { g -= 1; i = 0; } afficher(); } else suivante();
    });
    afficher();
  };
})();
