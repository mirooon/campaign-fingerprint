/**
 * Dictionaries of the page techniques that describe a scam funnel (I28): the tech-support alert that
 * demands a phone call, the remote-desktop tool the caller asks the victim to install, and the fake
 * "verification" that makes the visitor paste a command (ClickFix). Phrases are general (PL/EN/DE), not
 * copied from any case. The detectors in lib/osint/pageTechniques.ts read them from here; none of them
 * carries a link weight (a technique only describes the modus operandi, see lib/graph/config.ts).
 */

export const TECHNIQUE_CONFIG = {
  securityAlert: {
    /** Phrases of the alarm ("virus found", "computer locked", "account hacked", "call now"). */
    alarmPhrases: [
      /\bwirus\w*|zainfekowan\w*|zagro[żz]enie wykryte|wykryto (?:wirus|zagro[żz]enie)/i,
      /komputer\w*\s+(?:został\w*\s+)?zablokowan\w*|(?:twoje|twój|konto|konta)\s+\w*\s*(?:zostało\s+)?(?:zhakowan\w*|zablokowan\w*)/i,
      /zadzwo[ńn]\s+(?:natychmiast|teraz|pod numer|do nas)/i,
      /\b(?:critical|security|system) (?:error|alert|warning)\b|\bvirus(?:es)? (?:detected|found|alert)\b|\bmalware (?:detected|found)\b/i,
      /your (?:computer|pc|device|mac|account) (?:has been|is|was) (?:locked|blocked|infected|hacked|compromised|suspended)/i,
      /\b(?:microsoft|apple|windows defender|windows security) (?:support|security|technician|helpline)\b/i,
      /\bcall (?:now|immediately|us immediately|this number|toll[- ]free)\b/i,
      /\bvirus erkannt|(?:computer|pc|konto)\s+(?:wurde\s+)?gesperrt|ist infiziert|sicherheitswarnung|jetzt anrufen/i,
    ],
    /** Phone number in the visible text: 9 to 15 digits with the usual separators. */
    phoneNumber: /(?<![\w.:])\+?\d[\d\s().-]{7,19}\d(?![\w])/g,
    minPhoneDigits: 9,
    maxPhoneDigits: 15,
    /** How far from an alarm phrase (characters of visible text) a number still counts as its call to action. */
    phoneWindowChars: 400,
    /** Mechanisms that hold the visitor on the page, searched in the whole source (scripts included). */
    holdMechanisms: [
      /\b(?:onbeforeunload|beforeunload)\b/i,
      /\b(?:webkitR|mozR|msR|r)equestFull[sS]creen\b/,
      /keyboard\s*\.\s*lock\s*\(|requestPointerLock/,
      // an alert or confirm dialog in an endless loop or on a timer: the visitor cannot close it
      /(?:while\s*\(\s*(?:true|1)\s*\)|for\s*\(\s*;\s*;\s*\)|setInterval\s*\()[^}]{0,200}\b(?:alert|confirm)\s*\(/,
      /<audio\b[^>]*\bautoplay\b|new\s+Audio\s*\([^)]*\)[\s\S]{0,200}\.play\s*\(/i,
    ],
    /** A "scanning" animation or message in the visible text counts as a holding mechanism too. */
    scanPhrases: [/skanowanie (?:systemu|komputera|urz[ąa]dzenia)|scanning (?:your )?(?:system|computer|pc|device)|(?:system|computer) scan (?:in progress|running)|system wird gescannt/i],
  },
  remoteAccess: {
    /** Domains (registrable) of remote-desktop tools whose download link a fake support asks the victim to open. */
    hosts: ["anydesk.com", "anydesk.de", "teamviewer.com", "rustdesk.com", "ultraviewer.net", "screenconnect.com", "connectwise.com", "splashtop.com", "supremocontrol.com", "getscreen.me", "ammyy.com"],
    /** Names of the tools in running text. */
    toolNames: /\b(?:any\s?desk|team\s?viewer|quick\s?support|rust\s?desk|ultra\s?viewer|screen\s?connect|splashtop|supremo|ammyy|getscreen)\b/i,
    /** A verb of download or installation, within `instructionWindowChars` before the tool name. */
    instructionVerbs: /\b(?:pobierz|[śs]ci[ąa]gnij|zainstaluj|uruchom|download|install|run|herunterladen|installieren)\b/i,
    instructionWindowChars: 40,
    /** Path words of a download address. */
    downloadPath: /download|quick-?support|get-?started|\/dl\b|\.exe\b|\.dmg\b|\.msi\b/i,
    /** The instruction to read out the code the tool shows (9 digits, session ID). */
    codePhrases: /\b(?:podaj|przeka[żz]|poda[ćc])\b[^.]{0,30}\bkod|kod dost[ęe]pu|9[- ]cyfrow\w*|\b9[- ]digit\b|(?:access|session|connection) (?:code|id)\b|give (?:us|the technician) (?:the|your) (?:code|id)|zugangscode|(?:geben|nennen) sie (?:uns )?(?:den )?code/i,
  },
  clickfix: {
    /** Keyboard shortcut or terminal the visitor is told to use to run the pasted command. */
    shortcuts: [
      /(?:\bwin(?:dows)?(?:\s*key|-taste)?|klawisz windows|⊞)\s*\+\s*[rx]\b/i,
      /(?:⌘|\bcmd|\bcommand)\s*\+\s*(?:space|spacja)\b/i,
      /(?:open|otw[óo]rz|[öo]ffne)\s+(?:the\s+)?(?:terminal|powershell|command prompt|wiersz polecenia|eingabeaufforderung)/i,
    ],
    /** Words telling the visitor to paste what the page has copied. */
    pasteHints: /\bctrl\s*\+\s*v\b|⌘\s*\+\s*v\b|\bwklej\w*|\bpaste\b|\beinf[üu]gen\b/i,
    /** The cover story: a CAPTCHA or a "verification that you are not a robot". */
    verifyPhrases: /\b(?:verify|verification|human|robot|captcha)\b|weryfikac\w+|nie jeste[śs] robotem|kein roboter|\bmensch\b/i,
    /** Kinds of command, first match wins; only the kind and the hash of a command are kept. */
    commandKinds: [
      { kind: "curl_pipe_shell", pattern: /\b(?:curl|wget)\b[^|]{0,300}\|\s*(?:ba|z)?sh\b/i },
      { kind: "powershell", pattern: /\b(?:powershell(?:\.exe)?|pwsh)\b|\biex\b|invoke-expression|\s-e(?:nc|ncodedcommand)\b/i },
      { kind: "mshta", pattern: /\bmshta(?:\.exe)?\b/i },
      { kind: "cmd", pattern: /\bcmd(?:\.exe)?\s+\/[ck]\b/i },
      { kind: "bash", pattern: /\b(?:ba|z)?sh\s+-c\b/i },
      { kind: "osascript", pattern: /\bosascript\b/i },
      { kind: "script_host", pattern: /\b(?:wscript|cscript|rundll32|regsvr32|certutil|bitsadmin)\b/i },
    ],
    /** Longest command literal read (characters). */
    maxCommandChars: 4000,
  },
} as const;
