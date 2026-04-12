type ApiaDeadline = {
  date: string;
  task: string;
};

const DEADLINES: ApiaDeadline[] = [
  {
    date: "2026-05-15",
    task: "Depunerea cererii unice fara penalizari",
  },
  {
    date: "2026-06-10",
    task: "Actualizare parcele si documente justificative",
  },
  {
    date: "2026-10-16",
    task: "Inceput plati avans APIA",
  },
];

function daysLeft(dateIso: string): number {
  const now = new Date();
  const target = new Date(`${dateIso}T00:00:00`);
  const diffMs = target.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function formatDate(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString("ro-RO");
}

export function getApiaDeadlines(): string {
  const lines = DEADLINES.map((deadline) => {
    const remaining = daysLeft(deadline.date);
    const remainingLabel =
      remaining >= 0
        ? `${remaining} zile ramase`
        : `expirat acum ${Math.abs(remaining)} zile`;

    return `- ${formatDate(deadline.date)}: ${deadline.task} (${remainingLabel})`;
  });

  return ["Urmatoarele termene APIA:", ...lines].join("\n");
}
