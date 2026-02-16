import { describe, expect, it } from "vitest";
import { sha256 } from "../../lib/sha256";

describe("sha256", () => {
  it("hashes empty string", () => {
    // echo -n "" | shasum -a 256
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes simple string 'abc'", () => {
    // echo -n "abc" | shasum -a 256
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes longer string", () => {
    // echo -n "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" | shasum -a 256
    const input = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    expect(sha256(input)).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("supports incremental updates", () => {
    const hash = sha256.create();
    hash.update("a");
    hash.update("b");
    hash.update("c");
    expect(hash.hex()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("supports Uint8Array input", () => {
    const input = new TextEncoder().encode("abc");
    expect(sha256(input)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("supports ArrayBuffer input", () => {
    const input = new TextEncoder().encode("abc").buffer;
    expect(sha256(input)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
