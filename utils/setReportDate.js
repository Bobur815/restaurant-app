// helper to format "YYYY-MM-DD"
function formatYMD(date) {
    const Y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const D = String(date.getDate()       ).padStart(2, '0');
  return `${Y}-${M}-${D}`;
  }
  
  const today = new Date();
  const formattedToday  = formatYMD(today);
  
  // 7 days ago
  const sevenDaysAgo = formatYMD(
    new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
  );
  
  // 1 month ago
  const oneMonthAgoDate = new Date(today);
  oneMonthAgoDate.setMonth(oneMonthAgoDate.getMonth() - 1);
  const oneMonthAgo = formatYMD(oneMonthAgoDate);
  
  // 1 year ago
  const oneYearAgoDate = new Date(today);
  oneYearAgoDate.setFullYear(oneYearAgoDate.getFullYear() - 1);
  const oneYearAgo = formatYMD(oneYearAgoDate);
  
  // From start of current month
  const startOfMonth = formatYMD(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  
  // From start of current year
  const startOfYear = formatYMD(
    new Date(today.getFullYear(), 0, 1)
  );
  
  const setStartDate = {
    daily:    formattedToday,
    weekly:   sevenDaysAgo,
    monthly:  oneMonthAgo,
    yearly:   oneYearAgo,
    fromMonth: startOfMonth,
    fromYear:  startOfYear
  };

  export default setStartDate
  