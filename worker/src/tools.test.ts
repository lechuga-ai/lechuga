import { describe, expect, it } from "vitest";
import { isPrivateHost } from "./tools";

describe("isPrivateHost", () => {
  it("refuses names that only mean something on a local network", () => {
    for (const h of ["localhost", "LOCALHOST", "db.localhost", "printer.local", "api.internal", "1.0.0.10.in-addr.arpa"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });

  it("refuses private, loopback, link-local, metadata and other reserved IPv4 ranges", () => {
    for (const h of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "100.127.255.255", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });

  it("refuses IPv6 literals whole", () => {
    expect(isPrivateHost("[::1]")).toBe(true);
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[2001:db8::1]")).toBe(true);
  });

  it("lets the public web through", () => {
    for (const h of ["example.com", "en.wikipedia.org", "1.1.1.1", "8.8.8.8", "172.32.0.1", "100.128.0.1", "192.169.0.1"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });

  it("sees through numeric forms the URL parser normalises", () => {
    // new URL turns a decimal or octal IPv4 into dotted form before the
    // hostname is checked, so these reach isPrivateHost as 127.0.0.1.
    expect(isPrivateHost(new URL("http://2130706433/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://0x7f000001/").hostname)).toBe(true);
    expect(isPrivateHost(new URL("http://0177.0.0.1/").hostname)).toBe(true);
  });
});
