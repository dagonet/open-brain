# Open Brain: Agenten-lesbare Speicherarchitektur fuer KI

**Video:** "Your Second Brain Is Closed. Your AI Can't Use It." von Nate Herk
**Quelle:** [YouTube](https://www.youtube.com/watch?v=2JiMmye2ezg)
**Begleitanleitung:** [Nate's Substack](https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres)

---

## Kernthese

Der groesste Engpass bei der KI-Produktivitaet ist heute nicht die Modellqualitaet -- sondern die **Speicherarchitektur**. Jede KI-Plattform (Claude, ChatGPT, Gemini, Cursor) baut isolierten Speicher auf, der nicht mit anderen kommuniziert und fuer autonome Agenten nicht zugaenglich ist. Man muss seine eigene Speicherinfrastruktur besitzen.

## Das Problem

- Jedes Mal, wenn man einen neuen Chat oeffnet oder zwischen KI-Tools wechselt, startet man bei null.
- Plattform-eigene Speicherfunktionen sind als **Lock-in-Mechanismen** konzipiert -- sie halten den Nutzer abhaengig von einem Anbieter.
- Bestehende Notiz-Tools (Notion, Apple Notes, Obsidian, Evernote) wurden fuer das "menschliche Web" gebaut (visuelle Layouts, Ordnerstrukturen) und sind grundsaetzlich **nicht fuer agenten-lesbare semantische Abfragen konzipiert**.
- Da autonome Agenten zum Mainstream werden (OpenClaw mit ueber 190.000 GitHub-Stars, Anthropic entwickelt Agenten), wird diese Luecke kritisch: **Agenten brauchen strukturierten, semantisch durchsuchbaren Kontext**, um effektiv zu sein.
- Eine Harvard Business Review-Studie ergab, dass digitale Arbeitskraefte fast 1.200 Mal taeglich zwischen Anwendungen wechseln -- ein Grossteil davon ist Kontexttransfer statt echte Arbeit.

## Die Loesung: "Open Brain"-Architektur

Nate schlaegt ein datenbankgestuetztes, MCP-verbundenes Wissenssystem namens **Open Brain** vor. Die Architektur besteht aus drei Kernkomponenten:

### 1. PostgreSQL + pgvector als Fundament

Gedanken leben in einer Postgres-Datenbank, die **man selbst kontrolliert**. pgvector ermoeglicht Vektor-Embeddings, sodass jeder erfasste Gedanke eine mathematische Repraesentation seiner Bedeutung erhaelt -- was **semantische Suche** statt Stichwortsuche ermoeglicht. Postgres wurde bewusst gewaehlt, weil es langweilig, bewaehrt und nicht von VC-finanzierten SaaS-Diensten abhaengig ist.

### 2. Erfassungs-Pipeline (ueber Slack / beliebige Messaging-App nach Supabase)

Man tippt einen Gedanken in einen Slack-Kanal (oder einen beliebigen Input). Eine Supabase-Edge-Function fuehrt dann **parallel** aus:

- Generiert ein Vektor-Embedding der Bedeutung
- Extrahiert Metadaten (Personen, Themen, Typ, Aufgaben)
- Speichert alles in der Postgres-Datenbank mit pgvector

Die Bestaetigung kommt innerhalb von ~10 Sekunden im Thread zurueck.

### 3. MCP-Server fuer den Abruf

Ein MCP-Server verbindet sich mit der Datenbank und stellt drei Werkzeuge fuer jeden kompatiblen KI-Client bereit:

- **Semantische Suche** -- Gedanken nach Bedeutung finden
- **Letzte Eintraege auflisten** -- durchsuchen, was man diese Woche erfasst hat
- **Statistiken** -- eigene Muster erkennen

Jeder MCP-kompatible Client (Claude, Claude Code, ChatGPT, Cursor, VS Code) wird sowohl zum Erfassungspunkt als auch zum Suchwerkzeug.

## Architekturdiagramm

```
Eingabe (Slack, beliebige Messaging-App)
    |
Supabase Edge Function
    |-- Generiert Vektor-Embedding
    |-- Extrahiert Metadaten (Personen, Themen, Typ, Aufgaben)
    +-- Speichert beides in PostgreSQL + pgvector
    |
MCP-Server (3 Tools: semantic_search, list_recent, stats)
    |
Beliebiger KI-Client (Claude, ChatGPT, Cursor, Claude Code, VS Code, etc.)
```

## Setup-Anforderungen

- **Zeit:** ~45 Minuten, Copy-Paste, keine Programmierkenntnisse erforderlich
- **Infrastruktur:** Supabase Free Tier + Slack Free Tier
- **Laufende Kosten:** $0,10-$0,30/Monat fuer ~20 Gedanken/Tag an API-Aufrufen
- Getestet von einer Person ohne jegliche Programmiererfahrung, die das Setup in ~45 Minuten abgeschlossen hat

## Vier begleitende Prompts fuer den Speicher-Lebenszyklus

### 1. Speicher-Migration

Einmalig nach dem Setup ausfuehren. Extrahiert alles, was bestehende KIs (Claudes Speicher, ChatGPTs Speicher) bereits ueber den Nutzer wissen, und speichert es im Open Brain. Jedes neue KI-Tool startet dann mit dieser Grundlage statt bei null.

### 2. Open Brain Spark

Ein Interview-Prompt, der herausfindet, wie das System zum eigenen Workflow passt. Er fragt nach Tools, Entscheidungen, Wiedererklaerungsmustern und Schluesselpersonen und generiert dann eine nach Kategorien organisierte, personalisierte Liste dessen, was man regelmaessig in Open Brain einspeisen sollte. Nuetzlich, um Schreibblockaden beim Erfassen zu ueberwinden.

### 3. Schnellerfassungs-Vorlagen

Fuenf-Satz-Starter, optimiert fuer saubere Metadaten-Extraktion:

- **Entscheidungserfassung:** `Entscheidung: [was]. Kontext: [warum]. Verantwortlich: [wer].`
- **Personennotiz:** `[Name] -- [was passiert ist oder was man ueber die Person erfahren hat].`
- **Erkenntnis-Erfassung**
- **Meeting-Debrief**

Jede Vorlage ist darauf ausgelegt, die richtige Klassifizierung in der Verarbeitungspipeline auszuloesen. Nach etwa einer Woche entwickelt man eigene Muster und braucht die Vorlagen weniger.

### 4. Wochenrueckblick

Wochenend-Synthese ueber alles, was man erfasst hat:

- Clustert nach Themen
- Sucht nach offenen Aufgaben
- Erkennt Muster ueber Tage hinweg
- Findet Verbindungen, die man uebersehen hat
- Identifiziert Luecken in der Erfassung

Etwa 5 Minuten am Freitagnachmittag, die mit wachsendem Open Brain jede Woche wertvoller werden.

## Zentrale Erkenntnisse

- **Speicherarchitektur bestimmt die Agenten-Faehigkeiten** weit mehr als die Modellauswahl -- das wird weithin missverstanden.
- Das Internet gabelt sich in ein **menschliches Web** (Schriftarten, Layouts) und ein **Agenten-Web** (APIs, strukturierte Daten). Der eigene Speicher muss auf der Agenten-Web-Ebene leben.
- MCP wird als "USB-C der KI" beschrieben -- ein Protokoll, jede KI, die eigenen Daten bleiben an einem Ort.
- Der Zinseszins-Vorteil: Jeder erfasste Gedanke macht die naechste Suche intelligenter und die naechste Verbindung wahrscheinlicher. Person B (mit Open Brain) baut jede Woche einen Kontextvorteil gegenueber Person A (die bei null startet) auf.
- Gutes Context Engineering fuer Agenten fuehrt gleichzeitig zu gutem Context Engineering fuer Menschen -- Klarheit nuetzt allen.
- MCP-Server sind nicht nur zum Abruf da -- jeder MCP-kompatible Client wird sowohl zum Erfassungspunkt als auch zum Suchwerkzeug und ermoeglicht Dashboards, taegliche Zusammenfassungen und benutzerdefinierte Tools auf Basis derselben Daten.

## Relevanz fuer Enterprise-KI-Integration

Diese Architektur laesst sich direkt auf einen mehrschichtigen Enterprise-Ansatz abbilden:

- **Fundament-Schicht:** PostgreSQL + pgvector (aequivalent zu einem RAG-Wissensspeicher)
- **Zugangs-Schicht:** MCP-Server (standardisiertes Protokoll fuer jeden KI-Client)
- **Erfassungs-Schicht:** Edge Functions fuer automatisierte Embedding- und Metadaten-Extraktion

Fuer Enterprise-Anwendungsfaelle waeren zusaetzliche Schichten erforderlich:

- Audit-Logging und Compliance
- Authentifizierung und rollenbasierte Zugriffskontrolle
- Zentraler Orchestrator fuer das Routing zwischen mehreren MCP-Servern
- Integration mit bestehenden Tools (GitLab, Jira, Confluence, Artifactory)

Das Kernprinzip -- **in fundamentale Speicherinfrastruktur investieren, bevor man einzelne KI-Tools optimiert** -- gilt sowohl im persoenlichen als auch im Enterprise-Massstab.
