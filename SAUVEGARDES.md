# Sauvegardes de LinkCI

Chaque nuit (2 h, heure d'Abidjan), GitHub exporte **toute la base** (comptes,
publications, messages, fichiers stockes dans la table `fichiers`), la
**chiffre** avec `BACKUP_PASSPHRASE`, et la garde **14 jours** dans
*GitHub > Actions > Sauvegarde de la base* (section *Artifacts*).

Sans le mot de passe de chiffrement, le fichier est illisible : le depot est
public, mais les sauvegardes ne le sont pas en clair.

## Mise en place (une fois)
GitHub > depot `linkci` > **Settings > Secrets and variables > Actions > New repository secret** :

| Nom | Valeur |
|---|---|
| `DATABASE_URL` | l'adresse Neon (la meme que sur Render) |
| `BACKUP_PASSPHRASE` | un long mot de passe, a noter en lieu sur |

Puis *Actions > Sauvegarde de la base > Run workflow* pour un premier essai.

## Restaurer
1. Telecharger l'artefact `linkci-sauvegarde-N` (fichier `linkci.dump.gpg`).
2. Dechiffrer :
   `gpg --output linkci.dump --decrypt linkci.dump.gpg` (demande le mot de passe)
3. Restaurer dans une base PostgreSQL (vide ou nouvelle branche Neon) :
   `pg_restore --no-owner --no-privileges --dbname "ADRESSE_DE_LA_BASE" linkci.dump`

Neon garde aussi un historique court (restauration a un instant precis, depuis
le tableau de bord Neon > *Branches* / *Restore*).
