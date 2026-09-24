/**
 * Relais d'e-mails LINK CI (Google Apps Script)
 * Envoie les e-mails du site (mot de passe oublie...) depuis le Gmail du compte
 * qui deploie ce script. Gratuit, 100 e-mails par jour.
 *
 * Installation : script.google.com > Nouveau projet > coller ce fichier.
 * Le secret se met dans Parametres du projet > Proprietes du script :
 *   SECRET = (la valeur de GMAIL_SCRIPT_SECRET du fichier .env)
 * Puis Deployer > Nouveau deploiement > Application Web,
 *   Executer en tant que : Moi ; Qui a acces : Tout le monde.
 */
function doPost(e) {
  var reponse = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET');
    var d = JSON.parse(e.postData.contents);
    if (!secret || d.secret !== secret) return reponse({ ok: false, erreur: 'secret invalide' });
    var destinataire = String(d.to || '');
    // une seule adresse, pas de liste : le relais ne peut pas servir a spammer
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(destinataire)) return reponse({ ok: false, erreur: 'adresse invalide' });
    MailApp.sendEmail({
      to: destinataire,
      subject: String(d.subject || 'LINK CI').slice(0, 200),
      body: String(d.text || '').slice(0, 5000),
      name: 'LINK CI',
    });
    return reponse({ ok: true, restant: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reponse({ ok: false, erreur: String(err) });
  }
}

/** Test manuel depuis l'editeur : envoie un e-mail a toi-meme. */
function testerEnvoi() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), 'Test LINK CI', 'Le relais Gmail de LINK CI fonctionne.', { name: 'LINK CI' });
}
