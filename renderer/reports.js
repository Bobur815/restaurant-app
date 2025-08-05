import { showAlert } from "../utils/alert.js";
import setStartDate from "../utils/setReportDate.js";

const echartsLib = window.echarts;


let salesChart = null;
let productPieChart = null;
const clickSound = new Audio(new URL('../sounds/mixkit.wav', import.meta.url));
clickSound.preload = 'auto';

export async function loadReportsPage() {
  const typeEl = document.getElementById('reportType');
  const startDate = document.getElementById('startDate');
  const endDate = document.getElementById('endDate');
  const genBtn = document.getElementById('generateBtn');
  const printBtn = document.getElementById('printBtn');
  const out = document.getElementById('reportResult');

  const today = new Date().toISOString().split('T')[0];
  startDate.value = today;
  endDate.value = today;

  typeEl.addEventListener('change', () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });
    if (typeEl.value === 'custom') {
      startDate.disabled = false
      endDate.disabled = false
    } else {
      startDate.disabled = true
      endDate.disabled = true
      startDate.value = setStartDate[typeEl.value]
    }
  });

  typeEl.dispatchEvent(new Event('change'));

  genBtn.addEventListener('click', async () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => { });
    const params = new URLSearchParams();

    params.set('start', startDate.value);
    params.set('end', endDate.value);

    // 2) Fetch the time‐series report
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

    // 3) No results?
    if (!timeData) {
      out.innerHTML = '<p>Natija topilmadi.</p>';
      destroyCharts();
      return;
    }

    // 4) Render table and sales chart
    out.innerHTML = renderSimpleTable(timeData.daily, typeEl.value);
    // renderSalesEChart(timeData.daily, typeEl.value);
    // renderStackedEChart(timeData.daily, timeData.productsByDate);
    // renderSalesChart(timeData, typeEl.value);

    // // 5) Fetch product‐breakdown pie data
    // const prodParams = new URLSearchParams({
    //   start: timeData[0].key,
    //   end:   timeData[timeData.length - 1].key
    // });
    // let productData;
    // try {
    //   const res = await fetch(`http://localhost:3000/api/payment/product-report?${prodParams}`);
    //   if (!res.ok) {
    //     // if that endpoint fails, just warn and return
    //     const err = await res.json();
    //     showAlert(`❌ ${err.error || 'Mahsulotlar hisobotida xatolik'}`);
    //     return;
    //   }
    //   productData = await res.json();
    // } catch {
    //   return showAlert("🚫 Tarmoq muammosi. Mahsulotlar hisobotini yuklay olmadim.");
    // }

    // renderProductPieChart(productData);
  });

  printBtn.addEventListener('click', () => {
    clickSound.currentTime = 0;
    clickSound.play().catch(() => {/*ignore*/ });
    window.print()
  });
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
// ### Chiziqli graﬁk (line) ECharts bilan ###
// function renderSalesEChart(data, type) {
//   const dom = document.getElementById('salesChart');
//   // avval destroy qiling agar oldin bo‘lsa
//   if (salesChart) {
//     salesChart.dispose();
//   }
//   console.log(echartsLib);
//   salesChart = echartsLib.init(dom);

//   const labels = data.map(r => formatDMY(r.payment_date));
//   const totals = data.map(r => r.totalSumOfEachDay || 0);

//   const option = {
//     title: { text: `Savdo hisobot (${type})` },
//     tooltip: { trigger: 'axis' },
//     xAxis: { type: 'category', data: labels },
//     yAxis: { type: 'value', axisLabel: { formatter: v => v.toLocaleString() } },
//     series: [{
//       name: 'Jami summa',
//       type: 'line',
//       data: totals,
//       smooth: true
//     }]
//   };

//   salesChart.setOption(option);
// }


// pie chart of product quantities
// function renderProductPieChart(products) {
//   const ctx = document.getElementById('productPieChart').getContext('2d');

//   const labels = products.map(p => p.productName);
//   const counts = products.map(p => p.quantitySold);

//   productPieChart = new Chart(ctx, {
//     type: 'pie',
//     data: {
//       labels,
//       datasets: [{
//         data: counts,
//         borderWidth: 1
//       }]
//     },
//     options: {
//       responsive: true,
//       plugins: {
//         title: {
//           display: true,
//           text: 'Mahsulotlar bo‘yicha savdo ulushi'
//         },
//         legend: {
//           position: 'bottom'
//         }
//       }
//     }
//   });
// }

function formatDMY(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
}

// soddaroq HTML jadval
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
    </tr>
  `).join('');
  const totalOrders = data.reduce((s, r) => s + (r.numberOfOrders || 0), 0);
  const totalSum = data.reduce((s, r) => s + (r.totalSumOfEachDay || 0), 0);
  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>№</th><th>${label}</th><th>Buyurtmalar</th><th>Jami summa</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <th colspan="2">Jami:</th>
          <th>${totalOrders}</th>
          <th>${totalSum.toLocaleString()} so'm</th>
        </tr>
      </tfoot>
    </table>
  `;
}

// ### Stacked bar ECharts bilan ###
// function renderStackedEChart(daily, productsByDate) {
//   const dom = document.getElementById('productStackedChart');
//   if (stackedChart) {
//     stackedChart.dispose();
//   }
//   stackedChart = echartsLib.init(dom);

//   const labels = daily.map(r => formatDMY(r.payment_date));
//   const productNames = Array.from(new Set(
//     productsByDate.flatMap(g => g.products.map(p => p.productName))
//   ));

//   const series = productNames.map(name => ({
//     name,
//     type: 'bar',
//     stack: 'total',
//     emphasis: { focus: 'series' },
//     data: daily.map(r => {
//       const grp = productsByDate.find(g => g.date === r.payment_date);
//       return grp?.products.find(p => p.productName === name)?.quantitySold || 0;
//     })
//   }));

//   const option = {
//     title: { text: 'Mahsulot bo‘yicha kunlik sotuvlar' },
//     tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
//     legend: { data: productNames },
//     xAxis: { type: 'category', data: labels },
//     yAxis: { type: 'value' },
//     series
//   };

//   stackedChart.setOption(option);
// }

