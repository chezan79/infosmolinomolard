# REAL VOTE MONITORING DIAGNOSIS

**Ambito:** voto reale segnalato da Andrea e dashboard Administration di settembre 2026 in Preview. Solo esame del codice, della configurazione non segreta disponibile e dei metadati/log operativi accessibili; nessuna interrogazione dei dati elettorali e nessun nuovo voto. Lo stato «49 aventi diritto, 0 votanti» è quello riferito nella richiesta, **non** un conteggio Firestore verificato in questa diagnosi.

**Voting write path:** `POST /api/v1/public/election/ballots` dallo stesso origin della pagina `collaborateur-du-mois.html` → server Express → Firebase Admin Firestore (database predefinito dell'app Admin, *identità effettiva non verificata*) → `electionSites/{siteId}/dataEnvironments/{environment}/elections/{YYYY-MM}/participation/{identificativo riservato}` e `.../ballots/{ID casuale}`. Per il runtime di origine del voto, progetto/database, sito, namespace e mese effettivi **non verificati**. Il percorso non espone valori degli identificativi o il contenuto della scheda.

**Monitoring read path:** `GET /api/v1/management/election-monitoring`, con autorizzazione di sessione lato server → lo stesso oggetto Firebase Admin Firestore **se la richiesta arriva allo stesso processo server** → lettura proiettata dei soli metadati operativi di `electionSites/{siteId}/dataEnvironments/{environment}/elections/{YYYY-MM}` → query aggregate `.count()` su `.../participation` e `.../ballots`. La configurazione di sviluppo disponibile per Preview indica `siteId=molard`, namespace `development` e `Europe/Zurich`; per una richiesta nel mese locale di settembre, il percorso configurato sarebbe `electionSites/molard/dataEnvironments/development/elections/2026-09/{participation,ballots}`. Progetto/database Firestore effettivo di Preview **non verificato** indipendentemente dal processo. Non si presume che il voto originale sia passato da Preview.

## Confronto fra runtime che ha ricevuto il voto e runtime monitorato

| Campo richiesto | Risposta per il voto reale rispetto a Preview | Cosa è dimostrato |
| --- | --- | --- |
| Same Firebase project/database | **NON VERIFICATO** | `server.js` passa un unico `firebaseDb` ai due servizi nello stesso processo; non è noto il binding Firebase del processo storico di origine né quello effettivo di Preview. `admin.firestore()` usa l'app Admin corrente senza selezionare un database nominato nel codice. |
| Same siteId | **NON VERIFICATO** | Nello stesso processo entrambi leggono `EMPLOYEE_DIRECTORY_SITE_ID`; configurazione di sviluppo disponibile: `molard`. Sito dell'origin storico ignoto. |
| Same environment / namespace | **NON VERIFICATO** | Nello stesso processo entrambi leggono `ELECTION_DATA_ENVIRONMENT`; Preview è configurato come `development`. Il guard di avvio `NODE_ENV=production` imporrebbe `production`, ma non dimostra che il voto reale sia stato servito da quel runtime. |
| Same election month | **NON VERIFICATO** | I due servizi calcolano `YYYY-MM` tramite `electionWindow` in `Europe/Zurich` al momento delle rispettive richieste. A settembre locale 2026 entrambi sceglierebbero `2026-09`; istante/timezone del POST originale non accertati. La finestra di settembre è dal 25/09 ore 00:00 locali al 01/10 ore 00:00 locali escluso. |
| Same participation collection | **NON VERIFICATO** come collezione *effettiva*; **YES nel codice dello stesso processo e mese** | Entrambi usano `elections/{YYYY-MM}/participation`, senza filtri nella query aggregate. |
| Same ballots collection | **NON VERIFICATO** come collezione *effettiva*; **YES nel codice dello stesso processo e mese** | Entrambi usano `elections/{YYYY-MM}/ballots`, senza filtri nella query aggregate. |

**I percorsi sono esattamente identici?** **YES soltanto a parità di istanza server, binding Firestore e mese locale; per il voto reale versus Preview: NON VERIFICATO.** L'applicazione corrente non mostra una seconda scrittura in un percorso legacy nella rotta POST in esame, ma non è stato accertato quale versione/host servisse la sessione originale; un percorso legacy storico non può essere escluso dai soli sorgenti attuali. Non è stato dimostrato né escluso uno scarto sviluppo/produzione, un altro sito/progetto, un processo precedente o un cambio di mese.

## Conteggi aggregati osservati

**Observed aggregate counts in voting datastore (elezione settembre 2026):**
- Participation records: **NON VERIFICATO** — il datastore del POST originale non è identificato da una registrazione attendibile della richiesta e del binding runtime.
- Anonymous ballots: **NON VERIFICATO** — stesso impedimento.

**Observed aggregate counts in monitoring datastore (elezione settembre 2026):**
- Participation records: **NON VERIFICATO** — il dashboard riporta 0, ma non è stata eseguita una query diretta read-only su un progetto/database Firestore confermato.
- Anonymous ballots: **NON VERIFICATO** — il valore mostrato del dashboard non equivale a una query indipendente e non autorizza a inferire il conteggio di un altro namespace.

Non sono stati letti documenti di partecipazione, schede, grant, identificativi individuali, scelte né commenti. I soli metadati della distribuzione Replit confermano una distribuzione attiva distinta dal processo di Preview, senza identificare il runtime che ha ricevuto il voto. La configurazione `.replit` e le variabili non segrete di sviluppo descrivono Preview, non la destinazione storica. Il manifest Railway e `production-config.js` indicano il **progetto di configurazione previsto** per un eventuale runtime di produzione, non l'avvenuta ricezione di questa richiesta da parte di Railway. I log di distribuzione esaminati non contengono una correlazione attendibile fra POST originale e binding Firebase. Non è stato chiamato alcun endpoint pubblico elettorale, perché anche i GET del servizio possono creare un'elezione.

## Persistenza e risposta di successo

`collaborateur-du-mois.js` invia il POST same-origin e mostra successo solo dopo una risposta HTTP riuscita con `code: SUBMITTED`; l'handler risponde HTTP 201. `ElectionService.submit` autorizza il grant nel mese corrente, quindi `FirestoreElectionStore.submit` usa un'unica transazione che, nel **primo** invio accettato, crea sia `participation/{voterKey}` sia `ballots/{randomBallotId}` sotto **lo stesso documento elezione** e consuma il grant. L'audit successivo è best-effort e non annulla il commit. Se invece il grant era già consumato e la partecipazione esiste, il server restituisce di nuovo `SUBMITTED` con `replayed: true`, senza creare una nuova scheda: anche questo è mostrato come successo dalla UI. Un replay conferma una partecipazione già presente nel datastore e mese elaborati da quel server, non un nuovo voto e non l'identità del datastore letto dal dashboard. Dopo il cambio di mese il grant precedente non autorizza più il nuovo mese.

## ROOT CAUSE

**Non stabilita.** Il codice non evidenzia una divergenza di nomi o filtri delle due sottocollezioni nello stesso server. Una risposta di successo può derivare da un primo commit atomico oppure da un replay di partecipazione preesistente; nessuna delle due possibilità prova che la transazione sia avvenuta nel Firestore/mese monitorato in Preview. Per attribuire la discrepanza serve un'evidenza attendibile del dominio/origin e dell'ora locale del POST originale, del processo/versione che lo ha servito e dei binding server-side a progetto **e database** Firebase, sito e namespace di allora, confrontata con gli stessi binding del processo Preview attuale. Sono necessari anche conteggi aggregati indipendenti della stessa elezione in ciascun datastore identificato. Il numero 0 mostrato in Preview non prova di per sé un mismatch.

## RECOMMENDED FIX

**Nessuna correzione specifica è giustificata prima della verifica.** Un operatore autorizzato dovrebbe ottenere i registri affidabili del POST originale e le configurazioni effettive dei due processi (senza divulgare credenziali o dati del voto), poi confermare l'identità esatta di progetto/database, sito, namespace e mese. Solo dopo, con accesso server-side read-only autorizzato, verificare ciascun documento elezione tramite proiezione limitata dei campi operativi e due query aggregate `.count()` sulle sue sottocollezioni, senza leggere i documenti delle sottocollezioni. Se i binding divergono, correggere **solo dopo approvazione** il routing/configurazione del runtime che deve servire le richieste future; valutare separatamente, con procedura autorizzata e tutela dell'anonimato, l'eventuale necessità di recuperare dati già scritti. Se i binding coincidono, confrontare i conteggi e accertare versione/risposta del POST (primo commit o replay) prima di cambiare l'applicazione. Non modificare il dashboard sulla base del solo racconto o di un altro namespace.

## DATA MODIFICATION REQUIRED

**NON DETERMINABILE (né YES né NO con le prove disponibili).** La sola correzione *eventuale* di routing/configurazione futuro non richiederebbe modificare schede o partecipazioni esistenti; riallineare dati storici potrebbe richiederle, ma non è stato dimostrato necessario né è autorizzato. Nessuna modifica è stata effettuata.

**Riferimenti controllabili:** `collaborateur-du-mois.js:3,85-90,182-197`; `server.js:33-67`; `firebase-server-config.js:16-36`; `election-engine/index.js:36-73`; `election-engine/service.js:20-26,68-104`; `election-engine/firestore-store.js:10-24,104-136`; `election-engine/monitoring.js:12-69,74-100`; `election-engine/contract.js:48-59`; `.replit:63-70`; `production-config.js:61-111`; `docs/monthly-voting-phase1-audit.md:82-86`.