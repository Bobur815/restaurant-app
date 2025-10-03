// src/services/counter.service.js
// No global prisma calls here for sequencing!

export function formatOrderNumber(seq, date = new Date()) {
  // e.g. 2025-00007
  const yyyy = date.getFullYear();
  return `${yyyy}-${String(seq).padStart(5, "0")}`;
}

/**
 * Get next integer from Counter *inside the caller's transaction*.
 * Works on SQLite too. Returns the new (post-increment) value.
 */
export async function nextSeqTx(tx, id = "orders") {
  // Single statement path (atomic within tx): upsert + increment
  const row = await tx.counter.upsert({
    where: { id },
    create: { id, seq: 1 },            // first time -> 1
    update: { seq: { increment: 1 } }, // otherwise bump
    select: { seq: true },
  });
  return row.seq; // 1 on first call, N+1 afterwards
}
