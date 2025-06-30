
import { showAlert } from "../utils/alert.js";
import setStartDate from "../utils/setReportDate.js";


let salesChart = null;
let productPieChart = null;

export async function loadReportsPage() {
  const typeEl     = document.getElementById('reportType');
  const startDate  = document.getElementById('startDate');
  const endDate    = document.getElementById('endDate');
  const genBtn     = document.getElementById('generateBtn');
  const printBtn   = document.getElementById('printBtn');
  const out        = document.getElementById('reportResult');

  const today = new Date().toISOString().split('T')[0];
  startDate.value = today;
  endDate.value = today;
  
  typeEl.addEventListener('change', () => {
    if(typeEl.value === 'custom'){
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
    const params = new URLSearchParams();

    params.set('start', startDate.value);
    params.set('end',   endDate.value);
    
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
    out.innerHTML = renderReportTable(timeData.daily, typeEl.value);
    renderSalesChart(timeData, typeEl.value);

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

  printBtn.addEventListener('click', () => window.print());
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

function renderSalesChart(data, type) {
  const ctx = document.getElementById('salesChart').getContext('2d');
  if (salesChart) {
    salesChart.destroy();
  }

  const labels = data.daily.map(r => r.productName);
  const totals = data.daily.map(r => r.totalSumOfEachDay);

  salesChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Jami summa', data: totals, fill: false, borderWidth: 2, tension: 0.1 }] },
    options: {
      responsive: true,
      plugins: { title: { display: true, text: `Savdo hisobot (${type})` } },
      scales: { y: { ticks: { callback: v => v.toLocaleString() } } }
    }
  });
}

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

// render plain HTML table
function renderReportTable(data, type) {
  
  const label = {
    daily:   'Kun',
    weekly:  'Hafta',
    monthly: 'Oy',
    yearly:  'Yil',
    fromMonth: 'Oy boshidan',
    fromYear: 'Yil Boshidan',
    custom:  'Sana'
  }[type];

  const rows = data.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.payment_date}</td>
      <td>${r.numberOfOrders}</td>
      <td>${(r.totalSumOfEachDay ?? 0).toLocaleString()} so'm</td>
    </tr>
  `).join('');

  // compute totals
  const totalOrders = data.reduce((sum, r) => sum + (r.numberOfOrders ?? 0), 0);
  const totalSum    = data.reduce((sum, r) => sum + (r.totalSumOfEachDay ?? 0), 0);

  return `
    <table class="report-table">
      <thead>
        <tr>
          <th>№</th>
          <th>${label}</th>
          <th>Buyurtmalar soni</th>
          <th>Jami summa</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot style="
          position: sticky;
          bottom: 0;
          background: #fff;
          box-shadow: 0 -2px 5px rgba(0,0,0,0.1);
        ">
        <tr>
          <th colspan="2">Jami:</th>
          <th>${totalOrders}</th>
          <th>${totalSum.toLocaleString()} so'm</th>
        </tr>
      </tfoot>
    </table>
  `;
}
