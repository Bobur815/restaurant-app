import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  Tooltip,
  type Plugin,
  type ScriptableContext,
} from 'chart.js';
import type { DailyReportRow, Language } from '@shared/types';
import { t } from '../../i18n';
import { formatDate, formatMoney, formatNumber } from '../../utils/format';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const METHODS = ['cash', 'card', 'click', 'debt'] as const;

/** Reads a design token from the page (so the chart follows light/dark). */
const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** 0 / 950 / 1,2K / 3,4M: compact axis ticks. */
function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${formatNumber((n / 1_000_000).toFixed(1), 1)}M`;
  if (Math.abs(n) >= 1_000) return `${formatNumber((n / 1_000).toFixed(1), 1)}K`;
  return formatNumber(n, 0);
}

/** Day labels: "18.10". */
const shortDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;

/**
 * Daily revenue as stacked columns by payment method (part-to-whole over time). Follows the
 * dataviz spec: <=24px columns, 4px rounded top on the top segment only, 2px surface gap between
 * segments, hairline recessive grid, one axis, legend for the 4 series, the day's total as a
 * label on the cap (only while there is room), tooltip on hover. The daily table next to it is
 * the table view (light-mode contrast relief for aqua/yellow).
 */
export function createSalesChart(
  canvas: HTMLCanvasElement,
  days: string[],
  rows: DailyReportRow[],
  lang: Language,
) {
  const byDay = new Map(rows.map((r) => [r.date, r]));
  const value = (day: string, m: (typeof METHODS)[number]) => Number(byDay.get(day)?.[m] ?? 0);
  const totals = days.map((d) => METHODS.reduce((s, m) => s + value(d, m), 0));
  const surface = token('--color-surface');
  const text = token('--color-text');
  const muted = token('--color-text-muted');

  /** Index of the top non-empty segment per day: only it gets the rounded data-end. */
  const topIndex = days.map((d) => {
    let top = -1;
    METHODS.forEach((m, i) => {
      if (value(d, m) > 0) top = i;
    });
    return top;
  });

  const capLabels: Plugin<'bar'> = {
    id: 'savdochef-cap-labels',
    afterDatasetsDraw(chart) {
      if (days.length > 16) return; // selective: with many columns the tooltip carries totals
      const { ctx } = chart;
      ctx.save();
      ctx.fillStyle = muted;
      ctx.font = `600 11px ${token('--font-sans') || 'sans-serif'}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      days.forEach((_d, i) => {
        if (totals[i] === 0) return;
        const top = topIndex[i]!;
        const bar = chart.getDatasetMeta(top).data[i];
        if (bar) ctx.fillText(compact(totals[i]!), bar.x, bar.y - 4);
      });
      ctx.restore();
    },
  };

  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: days.map(shortDay),
      datasets: METHODS.map((m, i) => ({
        label: t(`reports.${m}`),
        data: days.map((d) => value(d, m)),
        backgroundColor: token(`--series-${i + 1}`),
        borderColor: surface,
        borderWidth: { top: 2, bottom: 0, left: 0, right: 0 },
        borderSkipped: false,
        borderRadius: (ctx: ScriptableContext<'bar'>) =>
          topIndex[ctx.dataIndex] === ctx.datasetIndex
            ? { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
            : 0,
        maxBarThickness: 24,
        categoryPercentage: 0.7,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? false
        : { duration: 250 },
      layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { color: token('--chart-grid') },
          ticks: { color: muted, maxRotation: 0, autoSkip: true },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: token('--chart-grid'), lineWidth: 1 },
          border: { display: false },
          ticks: { color: muted, callback: (v) => compact(Number(v)), maxTicksLimit: 6 },
        },
      },
      plugins: {
        legend: {
          position: 'top',
          align: 'start',
          labels: {
            color: text,
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: 'rectRounded',
          },
        },
        tooltip: {
          backgroundColor: token('--color-surface'),
          titleColor: text,
          bodyColor: text,
          footerColor: text,
          borderColor: token('--color-border'),
          borderWidth: 1,
          padding: 10,
          callbacks: {
            title: (items) => formatDate(`${days[items[0]?.dataIndex ?? 0] ?? ''}T00:00:00`),
            label: (item) => `${item.dataset.label}: ${formatMoney(String(item.raw ?? 0), lang)}`,
            footer: (items) =>
              `${t('reports.total')}: ${formatMoney(String(totals[items[0]?.dataIndex ?? 0] ?? 0), lang)}`,
          },
          filter: (item) => Number(item.raw) > 0,
        },
      },
    },
    plugins: [capLabels],
  });

  return { destroy: () => chart.destroy() };
}
