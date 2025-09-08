import { formatYMD } from "../../utils/setReportDate.js";

// ---------------Yordamchi funksiyalar ---------------------------
export function setDateHeader(headerTr, sessions, columns = 6) {
    if (!headerTr) return;

    const itemsCount = (sessions || []).reduce((sum, s) => {
        const arr = Array.isArray(s.items) ? s.items : [];
        return sum + arr.length;
    }, 0);

    if (!sessions?.length || itemsCount === 0) {
        headerTr.innerHTML = '';
        headerTr.style.display = 'none';
        return;
    }

    const days = Array.from(new Set(
        sessions.map(s => formatYMD(new Date(s.createdAt), false))
    )).sort();

    // Header label — 1 kun bo‘lsa friendly (Bugun/Kecha/kun+hafta), ko‘p bo‘lsa diapazon
    let label = '';
    if (days.length === 1) {
        const createdAt = new Date(sessions[0].createdAt);
        
        const time = createdAt.toLocaleTimeString('uz-Uz', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        label = ` ${friendlyDayLabel(days[0])} | ${time}`;
    } else {
        label = `${days[0]} → ${days[days.length - 1]}`;
    }

    // Header title — umumiy eng erta → eng kech vaqt
    const allTimes = sessions.map(s => new Date(s.createdAt));
    const minT = new Date(Math.min(...allTimes));
    const maxT = new Date(Math.max(...allTimes));
    const title = `${formatYMD(minT, false)} → ${formatYMD(maxT, false)}`;

    headerTr.style.display = 'table-row';
    headerTr.innerHTML = `
    <th colspan="${columns}"
        style="padding:10px 8px; font-size:16px; text-align:left;"
        title="${title}">
      📅 ${label} • ${itemsCount} ta pozitsiya
    </th>`;
}

export function friendlyDayLabel(dayStr) {

    const today = new Date();
    const d = new Date(dayStr + 'T00:00:00');
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);

    if (isSameYMD(d, today)) return 'Bugun';
    if (isSameYMD(d, yest)) return 'Kecha';

    return `${dayStr} - ${getWeekdayUzbek(d)}`;
}

export function getWeekdayUzbek(date) {
    const names = [
        'Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba',
        'Payshanba', 'Juma', 'Shanba'
    ];
    return names[date.getDay()];
}

export function isSameYMD(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
}