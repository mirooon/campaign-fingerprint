import { describe, expect, it } from "vitest";
import {
  base58CheckDecode,
  findWallets,
  isValidBech32Btc,
  isValidBtcBase58,
  isValidEthAddress,
  isValidTronAddress,
  toEip55,
} from "./crypto";

describe("isValidBtcBase58", () => {
  it("accepts mainnet P2PKH and P2SH addresses with valid checksums", () => {
    expect(isValidBtcBase58("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(true); // genesis block
    expect(isValidBtcBase58("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy")).toBe(true); // BIP-16 P2SH example
  });

  it("rejects bad checksums, bad characters and wrong lengths", () => {
    expect(isValidBtcBase58("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb")).toBe(false);
    expect(isValidBtcBase58("3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLz")).toBe(false);
    expect(isValidBtcBase58("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN0")).toBe(false); // 0 not in base58
    expect(isValidBtcBase58("1A1zP1eP5QGefi2DMPT")).toBe(false);
    expect(isValidBtcBase58("")).toBe(false);
  });

  it("rejects a valid Base58Check payload with a non-Bitcoin version byte (TRON)", () => {
    expect(isValidBtcBase58("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(false);
  });

  it("base58CheckDecode returns the payload including the version byte", () => {
    const payload = base58CheckDecode("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    expect(payload).not.toBeNull();
    expect(payload!.length).toBe(21);
    expect(payload![0]).toBe(0);
  });
});

describe("isValidBech32Btc", () => {
  it("accepts BIP-173 witness v0 vectors in lower and upper case", () => {
    expect(isValidBech32Btc("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(true);
    expect(isValidBech32Btc("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4")).toBe(true);
  });

  it("accepts bech32m (BIP-350) witness v1+ vectors, including taproot", () => {
    expect(isValidBech32Btc("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0")).toBe(true);
    expect(isValidBech32Btc("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr")).toBe(true);
    expect(
      isValidBech32Btc("bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y"),
    ).toBe(true);
    expect(isValidBech32Btc("BC1SW50QGDZ25J")).toBe(true);
  });

  it("rejects the wrong checksum variant for the witness version (BIP-350 invalid vectors)", () => {
    // v1 with a bech32 (not bech32m) checksum
    expect(isValidBech32Btc("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd")).toBe(false);
    // v0 with a bech32m checksum
    expect(isValidBech32Btc("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kemeawh")).toBe(false);
  });

  it("rejects mixed case, bad checksums and non-mainnet prefixes", () => {
    expect(isValidBech32Btc("bc1qW508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")).toBe(false);
    expect(isValidBech32Btc("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5")).toBe(false);
    expect(isValidBech32Btc("tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7")).toBe(false);
    expect(isValidBech32Btc("bc1")).toBe(false);
  });
});

describe("isValidEthAddress / EIP-55", () => {
  const checksummed = [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ];

  it("accepts EIP-55 mixed-case vectors and reproduces their casing", () => {
    for (const a of checksummed) {
      expect(isValidEthAddress(a)).toBe(true);
      expect(toEip55(a.toLowerCase())).toBe(a);
    }
  });

  it("accepts all-upper and all-lower hex (no checksum information)", () => {
    expect(isValidEthAddress("0x52908400098527886E0F7030069857D2E4169EE7")).toBe(true);
    expect(isValidEthAddress("0x8617E340B3D01FA5F11F306F4090FD50E238070D")).toBe(true);
    expect(isValidEthAddress("0xde709f2102306220921060314715629080e2fb77")).toBe(true);
    expect(isValidEthAddress("0x27b1fdb04752bbc536007a920d24acb045561c26")).toBe(true);
  });

  it("rejects a mixed-case address with one flipped letter", () => {
    expect(isValidEthAddress("0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(isValidEthAddress("0xFB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")).toBe(false);
  });

  it("rejects wrong lengths and non-hex", () => {
    expect(isValidEthAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe")).toBe(false);
    expect(isValidEthAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAedd")).toBe(false);
    expect(isValidEthAddress("0xZaAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(isValidEthAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
  });
});

describe("isValidTronAddress", () => {
  it("accepts a valid TRON address (USDT TRC-20 contract)", () => {
    expect(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true);
  });

  it("rejects a one-character change, wrong length and BTC addresses", () => {
    expect(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u")).toBe(false);
    expect(isValidTronAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6")).toBe(false);
    expect(isValidTronAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toBe(false);
  });
});

describe("findWallets", () => {
  it("finds every supported kind in order of appearance with canonical casing", () => {
    const text =
      "Wpłać BTC: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa, USDT (TRC20): TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t, " +
      "ETH: 0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed lub SegWit BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4.";
    expect(findWallets(text)).toEqual([
      { kind: "btc", address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa" },
      { kind: "tron", address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
      { kind: "eth", address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" },
      { kind: "btc", address: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" },
    ]);
  });

  it("dedupes repeated addresses (also across casings)", () => {
    const text =
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed i ponownie 0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed";
    expect(findWallets(text)).toEqual([{ kind: "eth", address: "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed" }]);
  });

  it("does not match the first 40 hex chars of a 64-hex transaction hash", () => {
    const tx = "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed5aaeb6053f3e94c9b9a09f33";
    expect(findWallets(`tx: ${tx}`)).toEqual([]);
  });

  it("does not match inside longer alphanumeric runs", () => {
    expect(findWallets("x1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa")).toEqual([]);
    expect(findWallets("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNaQ")).toEqual([]);
    expect(findWallets("ATR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toEqual([]);
  });

  it("drops look-alikes with invalid checksums and placeholder EVM addresses", () => {
    const text =
      "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u " +
      "0x5aaeb6053F3E94C9b9A09f33669435E7Ef1BeAed 0x0000000000000000000000000000000000000000 " +
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    expect(findWallets(text)).toEqual([]);
  });

  it("returns an empty list for empty input", () => {
    expect(findWallets("")).toEqual([]);
  });
});
