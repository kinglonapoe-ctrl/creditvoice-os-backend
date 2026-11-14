import { authenticatedGreetingScript, transferNoticeScript } from "@/lib/voice/test-call-script";

// Fictional credentials; this module has no services, network calls or persistence.
export const DEMO = { code: "12345678", account: "10001", pin: "1234", recipient: "10002", balance: 245000 };
export type DemoStep = "idle" | "code" | "account" | "pin" | "menu" | "notice" | "recipient" | "amount" | "confirm" | "ended";
export type DemoState = { step: DemoStep; message: string; balance: number; amount: number; entries: { debit: number; credit: number }[] };
export const initialDemo: DemoState = { step: "idle", message: "Welcome to the Community Cooperative demo.", balance: DEMO.balance, amount: 0, entries: [] };
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function startDemo(): DemoState {
  return { ...initialDemo, entries: [], step: "code", message: "Welcome to Community Cooperative. Please enter your organization access code, followed by the hash key." };
}
export function advanceDemo(state: DemoState, input: string): DemoState {
  const next = (step: DemoStep, message: string): DemoState => ({ ...state, step, message });
  const menu = () => next("menu", authenticatedGreetingScript("William Smith"));
  switch (state.step) {
    case "code": return input === DEMO.code ? next("account", "Please enter your account number, followed by the hash key.") : next("code", "That access code is not correct. Please try again.");
    case "account": return input === DEMO.account ? next("pin", "Please enter your four-digit PIN, followed by the hash key.") : next("account", "That demo account was not found. Please try again.");
    case "pin": return input === DEMO.pin ? menu() : next("pin", "That PIN is not correct. Please try again.");
    case "menu":
      if (input === "1") return next("menu", `Your available credit balance is ${money(state.balance)}. Press 2 for account information, 3 to transfer credit, or 9 to end the call.`);
      if (input === "2") return next("menu", "Your account belongs to William Smith. Account number 10001. Currency: US dollars. Press 1 for balance, 3 to transfer credit, or 9 to end the call.");
      if (input === "3") return next("notice", transferNoticeScript("Please check the recipient and amount carefully before confirming your transfer.") ?? "Press 1 to continue or 2 to return to the main menu.");
      if (input === "0") return next("menu", "Customer care is not connected in this demo. Press 1 for balance, 3 to transfer credit, or 9 to end the call.");
      if (input === "9") return next("ended", "Thank you for calling Community Cooperative. Goodbye.");
      return next("menu", "Invalid option. Press 1 for balance, 2 for account information, 3 to transfer credit, 0 for customer care, or 9 to end the call.");
    case "notice": return input === "1" ? next("recipient", "Please enter recipient account number 10002, followed by the hash key.") : input === "2" ? menu() : next("notice", "Press 1 to continue or 2 to return to the main menu.");
    case "recipient": return input === DEMO.recipient ? next("amount", "Please enter an amount in dollars, followed by the hash key.") : next("recipient", "Recipient not found. Enter demo account 10002.");
    case "amount": {
      const amount = Number(input) * 100;
      if (!/^\d+$/.test(input) || !Number.isSafeInteger(amount) || amount <= 0 || amount > state.balance) return next("amount", "Invalid amount or insufficient demo balance. Please try again.");
      return { ...next("confirm", `Transfer ${money(amount)} to Alex Morgan, account 10002. Press 1 to confirm or 2 to cancel.`), amount };
    }
    case "confirm":
      if (input === "2") return next("menu", "Transfer canceled. Press 1 for balance, 3 to transfer credit, or 9 to end the call.");
      if (input !== "1") return next("confirm", "Press 1 to confirm or 2 to cancel.");
      return { ...next("menu", `Demo transfer complete. Your balance is ${money(state.balance - state.amount)}. Press 1 for balance, 3 to transfer credit, or 9 to end the call.`), balance: state.balance - state.amount, amount: 0, entries: [...state.entries, { debit: state.amount, credit: state.amount }] };
    default: return state;
  }
}