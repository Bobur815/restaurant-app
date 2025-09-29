import { showAlert } from "../utils/alert.js";
import setStartDate from "../utils/setReportDate.js";



let salesChart = null;
let productPieChart = null;
const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

export async function loadReportsPage() {
  const typeEl = document.getElementById('reportType');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');
  const printBtn = document.getElementById('printBtn');
  const out = document.getElementById('reportResult');
  const orderByType = document.getElementById('orderByType');
  const orderDirection = document.getElementById('orderDirection');

  const today = new Date().toISOString().split('T')[0];
  startDate.value = today;
  endDate.value = today;

  // umumiy fetch funksiyasi
  async function fetchAndRenderReports() {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });

    if (typeEl.value === 'custom') {
      startDate.disabled = false;
      endDate.disabled = false;
    } else {
      startDate.disabled = true;
      endDate.disabled = true;
      startDate.value = setStartDate[typeEl.value];
    }

    const params = new URLSearchParams();
    params.set('start', startDate.value);
    params.set('end', endDate.value);
    params.set('bytype', orderByType.value);
    params.set('direction', orderDirection.value);

    let timeData;
    try {
      const res = await fetch(`http://localhost:3000/api/payment/report?${params}`);
      if (!res.ok) {
        const err = await res.json();
        return showAlert(`❌ ${err.error || 'Hisobot olishda xatolik'}`);
      }
      timeData = await res.json();
    } catch {
      return showAlert("🚫 Tarmoq muammosi. Iltimos, qayta urinib ko‘ring.");
    }

    if (!timeData) {
      out.innerHTML = '<p>Natija topilmadi.</p>';
      destroyCharts();
      return;
    }

    out.innerHTML = renderSimpleTable(timeData.daily, typeEl.value);
  }

  // eventlar
  typeEl.addEventListener('change', fetchAndRenderReports);
  orderByType.addEventListener('change', fetchAndRenderReports);
  orderDirection.addEventListener('change', fetchAndRenderReports);

  printBtn.addEventListener('click', () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/*ignore*/ });
    window.print();
  });

  // sahifa yuklanganda birinchi hisobotni ko‘rsatib qo‘yamiz
  await fetchAndRenderReports();
}



// helper: clear any existing Chart instances
function destroyCharts() {
  if (salesChart) {
    salesChart.destroy();
    salesChart = null;
  }
  if (productPieChart) {
    productPieChart.destroy();
    productPieChart = null;
  }
}

function formatDMY(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
}

function renderSimpleTable(data, type) {
  const label = {
    daily: 'Kun',
    weekly: 'Hafta',
    monthly: 'Oy',
    yearly: 'Yil',
    fromMonth: 'Oy boshidan',
    fromYear: 'Yil boshidan',
    custom: 'Sana'
  }[type];
  
  const rows = data.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${formatDMY(r.payment_date)}</td>
      <td>${r.numberOfOrders}</td>
      <td>${(r.totalSumOfEachDay || 0).toLocaleString()} so'm</td>
      <td>${(r.cashSum || 0).toLocaleString()} so'm</td>
      <td>${(r.plasticSum || 0).toLocaleString()} so'm</td>
      <td>${(r.creditSum || 0).toLocaleString()} so'm</td>
      <td>${(r.expenseSum || 0).toLocaleString()} so'm</td>
    </tr>
  `).join('');

  const totalOrders = data.reduce((s, r) => s + (r.numberOfOrders || 0), 0);
  const totalSum = data.reduce((s, r) => s + (r.totalSumOfEachDay || 0), 0);
  const totalCash = data.reduce((s, r) => s + (r.cashSum || 0), 0);
  const totalCard = data.reduce((s, r) => s + (r.plasticSum || 0), 0);
  const totalCredit = data.reduce((s, r) => s + (r.creditSum || 0), 0);

  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>№</th>
          <th>${label}</th>
          <th>Buyurtmalar</th>
          <th>Summa</th>
          <th>Naqd</th>
          <th>Karta</th>
          <th>Nasiya</th>
          <th>Chiqim</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <th>#${data.length}</th>
          <th>Jami:</th>
          <th>${totalOrders}</th>
          <th>${totalSum.toLocaleString()} so'm</th>
          <th>${totalCash.toLocaleString()} so'm</th>
          <th>${totalCard.toLocaleString()} so'm</th>
          <th>${totalCredit.toLocaleString()} so'm</th>
          <th>0 so'm</th>
        </tr>
      </tfoot>
    </table>
  `;
}
