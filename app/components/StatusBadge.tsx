import type { BookingStatus } from "@/lib/rules";

const LABEL: Record<BookingStatus, string> = { blocked: "Blocked", check: "Check before shipping", ready: "Ready for take-off" };
const CLASS: Record<BookingStatus, string> = {
  blocked: "bg-bad text-white",
  check: "bg-warn text-white",
  ready: "bg-accent text-black border border-ink",
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`badge ${CLASS[status]}`}>{LABEL[status]}</span>;
}
