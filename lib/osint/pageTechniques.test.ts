import { describe, expect, it } from "vitest";
import { backTrap, commentBlock, detectPageTechniques, fakeAppStore, fakeSocialPost, normaliseAuthor } from "./pageTechniques";

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
    expect(detectPageTechniques("", "https://x.example/")).toEqual({ techniques: [], commentBlock: null });
  });
});
