/** Voices an organization may choose for its phone line. */
export const IVR_VOICES = [
  { value: "Polly.Joanna-Neural", label: "Joanna — female, US (natural)", language: "en-US" },
  { value: "Polly.Salli-Neural", label: "Salli — female, US (natural)", language: "en-US" },
  { value: "Polly.Amy-Neural", label: "Amy — female, British (natural)", language: "en-GB" },
  { value: "Polly.Matthew-Neural", label: "Matthew — male, US (natural)", language: "en-US" },
  { value: "Polly.Joey-Neural", label: "Joey — male, US (natural)", language: "en-US" },
  { value: "Polly.Brian-Neural", label: "Brian — male, British (natural)", language: "en-GB" },
  { value: "alice", label: "Classic (robotic)", language: "en-US" },
] as const;

export function findVoice(value: string | null | undefined) {
  return IVR_VOICES.find((v) => v.value === value);
}
