"""Groupes comme WhatsApp, statuts (texte, vues, reponse), documents 2.0 (filtres, votes)."""
import io
import app as linkci_app
from test_securite import sql, entete


def compte(client, email):
    linkci_app.rate_limits.clear()
    return client.post('/api/register', json={'nom': 'N', 'prenom': 'P', 'email': email, 'mot_de_passe': 'motdepasse123'}).get_json()['token']


def uid(client, tok):
    return client.get('/api/me', headers=entete(tok)).get_json()['id']


def test_groupe_reactions_sondage_reponse_suppression(client):
    a, b, dehors = compte(client, 'gw.a@test.ci'), compte(client, 'gw.b@test.ci'), compte(client, 'gw.c@test.ci')
    gid = client.post('/api/groupes', json={'nom': 'Promo L3 test', 'description': 'x'}, headers=entete(a)).get_json()['id']
    client.post(f'/api/groupes/{gid}/rejoindre', headers=entete(b))
    m1 = client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'Qui a le cours de lundi ?'}, headers=entete(a)).get_json()['id']
    m2 = client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'Moi !', 'reponse_a': m1}, headers=entete(b)).get_json()['id']
    # sondage : au moins 2 choix
    assert client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'Quand ?', 'sondage': ['Lundi']}, headers=entete(a)).status_code == 400
    s = client.post(f'/api/groupes/{gid}/messages', json={'contenu': 'On revise quand ?', 'sondage': ['Samedi', 'Dimanche']}, headers=entete(a)).get_json()['id']
    msgs = {m['id']: m for m in client.get(f'/api/groupes/{gid}/messages', headers=entete(b)).get_json()}
    assert msgs[m2]['reponse']['extrait'] == 'Qui a le cours de lundi ?'
    opt = msgs[s]['sondage'][1]['id']
    r = client.post(f'/api/groupes/{gid}/messages/{s}/vote', json={'option_id': opt}, headers=entete(b)).get_json()
    assert r['mon_vote'] == opt and r['sondage'][1]['votes'] == 1
    assert client.post(f'/api/groupes/{gid}/messages/{s}/vote', json={'option_id': 999999}, headers=entete(b)).status_code == 400
    # reactions ; pas pour un non-membre
    assert client.post(f'/api/groupes/{gid}/messages/{m1}/reaction', json={'emoji': '❤️'}, headers=entete(dehors)).status_code == 403
    r = client.post(f'/api/groupes/{gid}/messages/{m1}/reaction', json={'emoji': '❤️'}, headers=entete(b)).get_json()
    assert r['reactions'] == [{'emoji': '❤️', 'nb': 1, 'moi': True}]
    # modifier : seulement l'auteur
    assert client.put(f'/api/groupes/{gid}/messages/{m1}', json={'contenu': 'pirate'}, headers=entete(b)).status_code == 403
    assert client.put(f'/api/groupes/{gid}/messages/{m1}', json={'contenu': 'Qui a le cours de mardi ?'}, headers=entete(a)).get_json()['modifie']
    # supprimer pour tous : la citation affiche "Message supprime"
    assert client.delete(f'/api/groupes/{gid}/messages/{m1}', headers=entete(a)).status_code == 200
    msgs = {m['id']: m for m in client.get(f'/api/groupes/{gid}/messages', headers=entete(b)).get_json()}
    assert msgs[m1]['supprime'] and msgs[m1]['contenu'] == '' and msgs[m1]['reactions'] == []
    assert msgs[m2]['reponse']['extrait'] == 'Message supprime'


def test_statuts_texte_vues_reponse(client):
    a, b = compte(client, 'st.a@test.ci'), compte(client, 'st.b@test.ci')
    ida, idb = uid(client, a), uid(client, b)
    assert client.post('/api/stories', json={'texte': '  '}, headers=entete(a)).status_code == 400
    sid = client.post('/api/stories', json={'texte': 'Bonne chance pour les partiels !', 'fond': '#2563EB'}, headers=entete(a)).get_json()['id']
    vus = client.get('/api/stories', headers=entete(b)).get_json()
    st = [g for g in vus if g['user_id'] == ida][0]
    assert st['stories'][0]['fond'] == '#2563EB' and st['stories'][0]['image'] is None and not st['tout_vu']
    assert 'nb_vues' not in st['stories'][0]  # le compteur n'est visible que par l'auteur
    client.post(f'/api/stories/{sid}/vue', headers=entete(b))
    client.post(f'/api/stories/{sid}/vue', headers=entete(b))  # deux fois : une seule vue
    client.post(f'/api/stories/{sid}/vue', headers=entete(a))  # l'auteur ne compte pas
    assert [v['id'] for v in client.get(f'/api/stories/{sid}/vues', headers=entete(a)).get_json()] == [idb]
    assert client.get(f'/api/stories/{sid}/vues', headers=entete(b)).status_code == 404
    mien = [g for g in client.get('/api/stories', headers=entete(a)).get_json() if g['est_moi']][0]
    assert mien['stories'][0]['nb_vues'] == 1
    assert [g for g in client.get('/api/stories', headers=entete(b)).get_json() if g['user_id'] == ida][0]['tout_vu']
    # repondre au statut en message prive
    mid = client.post('/api/messages', json={'destinataire_id': ida, 'contenu': 'Merci !', 'story_id': sid}, headers=entete(b)).get_json()['id']
    m = {x['id']: x for x in client.get(f'/api/messages?avec={idb}', headers=entete(a)).get_json()}[mid]
    assert m['story_id'] == sid and m['story_apercu'] == 'Bonne chance pour les partiels !'
    client.delete(f'/api/stories/{sid}', headers=entete(a))
    assert sql('SELECT COUNT(*) AS n FROM story_vues WHERE story_id = ?', (sid,))[0]['n'] == 0


def test_documents_filtres_et_votes(client):
    a, b = compte(client, 'doc2.a@test.ci'), compte(client, 'doc2.b@test.ci')
    pdf = b'%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'
    r = client.post('/api/documents', headers=entete(a), content_type='multipart/form-data', data={
        'titre': 'Sujet examen algo 2025', 'matiere': 'Algorithmique', 'universite': 'UFHB', 'filiere': 'Informatique',
        'type_doc': 'examen', 'fichier': (io.BytesIO(pdf), 'sujet.pdf')})
    assert r.status_code == 201, r.get_json()
    did = r.get_json()['id']
    docs = client.get('/api/documents?type=examen&filiere=informatique&q=algo', headers=entete(b)).get_json()
    assert [d['id'] for d in docs] == [did] and docs[0]['type_doc'] == 'examen'
    assert did not in [d['id'] for d in client.get('/api/documents?type=td', headers=entete(b)).get_json()]
    assert client.post(f'/api/documents/{did}/vote', headers=entete(b)).get_json() == {'mon_vote': True, 'nb_votes': 1}
    top = client.get('/api/documents?tri=utiles', headers=entete(b)).get_json()
    assert top[0]['id'] == did and top[0]['mon_vote']
    assert client.post(f'/api/documents/{did}/vote', headers=entete(b)).get_json() == {'mon_vote': False, 'nb_votes': 0}
    f = client.get('/api/documents/filtres', headers=entete(b)).get_json()
    assert 'Informatique' in f['filiere'] and 'examen' in f['types']
