import { describe, expect, test } from "bun:test";
import { advanceDemo, DEMO, startDemo, type DemoState } from "../../src/lib/public-demo";
function authenticated(): DemoState {
  return [DEMO.code, DEMO.account, DEMO.pin].reduce(advanceDemo, startDemo());
}
function confirmation(): DemoState {
  return ["3", "1", DEMO.recipient, "100"].reduce(advanceDemo, authenticated());
}
describe("fictional public voice demo", () => {
  test("wrong PIN cannot access the menu", () => {
    const account = [DEMO.code, DEMO.account].reduce(advanceDemo, startDemo());
    expect(advanceDemo(account, "9999").step).toBe("pin");
    expect(advanceDemo(account, DEMO.pin).step).toBe("menu");
  });
  test("notice requires acknowledgment before recipient entry", () => {
    const notice = advanceDemo(authenticated(), "3");
    expect(notice.step).toBe("notice");
    expect(advanceDemo(notice, "1").step).toBe("recipient");
    expect(advanceDemo(notice, "2").step).toBe("menu");
    expect(advanceDemo(notice, "5").step).toBe("notice");
  });
  test("cancellation preserves demo balance and creates no entries", () => {
    const state = advanceDemo(confirmation(), "2");
    expect(state.balance).toBe(245000);
    expect(state.entries).toHaveLength(0);
  });
  test("confirmation updates only demo state with matching paired entries", () => {
    const state = advanceDemo(confirmation(), "1");
    expect(state.balance).toBe(235000);
    expect(state.entries).toEqual([{ debit: 10000, credit: 10000 }]);
  });
  test("zero and amounts above balance are rejected", () => {
    const amount = ["3", "1", DEMO.recipient].reduce(advanceDemo, authenticated());
    expect(advanceDemo(amount, "0").step).toBe("amount");
    expect(advanceDemo(amount, "2451").step).toBe("amount");
  });
  test("reset starts with fictional USD 2450 and empty activity", () => {
    const fresh = startDemo();
    expect(fresh.balance).toBe(245000);
    expect(fresh.entries).toHaveLength(0);
  });
});