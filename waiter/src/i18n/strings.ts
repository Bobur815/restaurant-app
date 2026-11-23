/**
 * SavdoChef Ofitsiant — UI strings, Uzbek (Latin) and Russian.
 * Taken from the Design canvas, page "v2" (2026-11-21); keys marked F20-W were added while
 * building the app (plan answers 5 and 6, and states the frames did not draw).
 *
 * Placeholders use {name}. Russian plurals use the i18next-style suffixes _one / _few / _many;
 * Uzbek has no plural forms, so its three values are identical.
 * Data that comes from the till (hall names, dish names, category names other than "all",
 * waiter names, restaurant name) is NOT here.
 * Money: whole so'm, thousands grouped with a no-break space (U+00A0): "274 000 so'm".
 * Decimals use a comma: "0,450 kg".
 */

export type Locale = 'uz' | 'ru';

export const strings = {
  // Common
  'common.back': { uz: 'Orqaga', ru: 'Назад' },
  'common.close': { uz: 'Yopish', ru: 'Закрыть' },
  'common.cancel': { uz: 'Bekor qilish', ru: 'Отмена' },
  'common.retry': { uz: 'Qayta urinish', ru: 'Повторить' },
  'common.save': { uz: 'Saqlash', ru: 'Сохранить' },
  'common.add': { uz: "Qo'shish", ru: 'Добавить' },
  'common.erase': { uz: "O'chirish", ru: 'Стереть' },
  'common.remove': { uz: "O'chirish", ru: 'Удалить' },
  'common.increase': { uz: "Ko'paytirish", ru: 'Больше' },
  'common.decrease': { uz: 'Kamaytirish', ru: 'Меньше' },
  'common.currency': { uz: "so'm", ru: 'сум' },
  'common.unit.kg': { uz: 'kg', ru: 'кг' },
  'common.unit.portion': { uz: 'porsiya', ru: 'порции' },
  'common.unit.perPortion': { uz: 'porsiya', ru: 'порция' },
  'common.table': { uz: 'Stol {n}', ru: 'Стол {n}' },
  'common.minutes': { uz: '{m} daq', ru: '{m} мин' },
  'common.hoursMinutes': { uz: '{h} s {m} daq', ru: '{h} ч {m} мин' },

  // PIN
  'pin.langChip': { uz: 'RU', ru: 'UZ' },
  'pin.langAria': { uz: "Tilni rus tiliga o'zgartirish", ru: 'Сменить язык на узбекский' },
  'pin.connectAria': { uz: 'Kassaga ulash', ru: 'Подключение к кассе' },
  'pin.prompt': { uz: 'PIN kodingizni kiriting', ru: 'Введите PIN-код' },
  'pin.dotsAria': { uz: '4 tadan {n} ta raqam kiritildi', ru: 'Введено {n} из 4 цифр' },
  'pin.wrong': { uz: "PIN noto'g'ri", ru: 'Неверный PIN' },
  'pin.checking': { uz: 'Tekshirilmoqda…', ru: 'Проверка…' },
  'pin.locked.title': { uz: "Juda ko'p noto'g'ri urinish", ru: 'Слишком много неверных попыток' },
  'pin.locked.retryIn': { uz: "{time} dan keyin qayta urinib ko'ring", ru: 'Повторите через {time}' },
  'pin.offline.title': { uz: "Asosiy kassa bilan aloqa yo'q", ru: 'Нет связи с основной кассой' },
  'pin.offline.body': { uz: 'Qayta ulanmoqda…', ru: 'Переподключение…' },
  'pin.unpaired.title': { uz: 'Telefon hali kassaga ulanmagan', ru: 'Телефон ещё не подключён к кассе' },
  'pin.unpaired.body': {
    uz: 'Kassada QR kodni oching va uni shu telefon bilan skanerlang.',
    ru: 'Откройте QR-код на кассе и отсканируйте его этим телефоном.',
  },
  'pin.unpaired.cta': { uz: 'Kassaga ulash', ru: 'Подключить к кассе' },
  'pin.conn.ok': { uz: 'Kassa: {address}', ru: 'Касса: {address}' },
  'pin.conn.off': { uz: "Kassa: {address} · aloqa yo'q", ru: 'Касса: {address} · нет связи' },
  'pin.conn.none': { uz: 'Kassa ulanmagan', ru: 'Касса не подключена' },

  // Connect
  'connect.title': { uz: 'Kassaga ulash', ru: 'Подключение к кассе' },
  'connect.scan.where': { uz: 'Kassada:', ru: 'На кассе:' },
  'connect.scan.path': {
    uz: "Sozlamalar → Yo'ldosh kassalar → Telefon qo'shish",
    ru: 'Настройки → Дополнительные кассы → Добавить телефон',
  },
  'connect.scan.hint': { uz: 'Ekrandagi QR kodni skanerlang', ru: 'Отсканируйте QR-код с экрана' },
  'connect.manualEntry': { uz: "Qo'lda kiritish", ru: 'Ввести вручную' },
  'connect.denied.title': { uz: 'Kameraga ruxsat kerak', ru: 'Нужен доступ к камере' },
  'connect.denied.body': {
    uz: "Kassadagi QR kodni o'qish uchun ilovaga kameradan foydalanishga ruxsat bering. Kamera faqat skanerlash uchun ishlatiladi.",
    ru: 'Разрешите приложению доступ к камере, чтобы считать QR-код с кассы. Камера используется только для сканирования.',
  },
  'connect.denied.settingsPath': {
    uz: 'Ruxsat oynasi chiqmasa: Telefon sozlamalari → Ilovalar → SavdoChef → Ruxsatlar → Kamera',
    ru: 'Если окно не появилось: Настройки телефона → Приложения → SavdoChef → Разрешения → Камера',
  },
  'connect.denied.cta': { uz: 'Ruxsat berish', ru: 'Разрешить' },
  'connect.manual.intro': {
    uz: 'Kassa ekranidagi QR kod ostida manzil va 6 xonali kod yozilgan. Ularni shu yerga kiriting.',
    ru: 'Под QR-кодом на экране кассы указаны адрес и 6-значный код. Введите их здесь.',
  },
  'connect.manual.address': { uz: 'Kassa manzili', ru: 'Адрес кассы' },
  'connect.manual.addressPlaceholder': { uz: '192.168.1.10', ru: '192.168.1.10' },
  'connect.manual.code': { uz: 'Juftlash kodi', ru: 'Код сопряжения' },
  'connect.manual.codeDigitAria': { uz: '{n}-raqam', ru: 'Цифра {n}' },
  'connect.manual.codeHint': { uz: 'Kod 10 daqiqa amal qiladi.', ru: 'Код действует 10 минут.' },
  'connect.manual.cta': { uz: 'Ulash', ru: 'Подключить' },
  'connect.pairing': { uz: 'Ulanmoqda…', ru: 'Подключение…' },
  'connect.success.title': { uz: 'Ulandi', ru: 'Подключено' },
  'connect.success.version': { uz: 'Kassa versiyasi {version}', ru: 'Версия кассы {version}' },
  'connect.success.cta': { uz: 'Davom etish', ru: 'Продолжить' },
  'connect.error.wrongCode': { uz: "Kod noto'g'ri", ru: 'Неверный код' },
  'connect.error.expired.title': { uz: 'Kodning muddati tugagan', ru: 'Срок действия кода истёк' },
  'connect.error.expired.body': { uz: 'Kassada yangi kod oling', ru: 'Получите новый код на кассе' },
  'connect.error.notFound.title': { uz: 'Kassa topilmadi', ru: 'Касса не найдена' },
  'connect.error.notFound.body': {
    uz: "Telefon kassa bilan bir Wi-Fi tarmog'idami?",
    ru: 'Телефон в той же сети Wi-Fi, что и касса?',
  },
  'connect.error.plan.title': { uz: "Tarifingizda ofitsiant ilovasi yo'q", ru: 'В вашем тарифе нет приложения официанта' },
  'connect.error.plan.body': { uz: 'Standard yoki Pro tarifi kerak', ru: 'Нужен тариф Standard или Pro' },
  'connect.error.version.title': { uz: 'Kassa va ilova versiyalari mos emas', ru: 'Версии кассы и приложения не совпадают' },
  'connect.error.version.body': { uz: 'Ilovani yangilang', ru: 'Обновите приложение' },
  'connect.paired.status': { uz: 'Ulangan', ru: 'Подключено' },
  'connect.paired.address': { uz: 'Kassa manzili', ru: 'Адрес кассы' },
  'connect.paired.lastSeen': { uz: 'Oxirgi aloqa', ru: 'Последняя связь' },
  'connect.paired.now': { uz: 'hozir', ru: 'сейчас' },
  'connect.paired.phoneName': { uz: 'Telefon nomi', ru: 'Имя телефона' },
  'connect.paired.appVersion': { uz: 'Ilova versiyasi', ru: 'Версия приложения' },
  'connect.paired.update': { uz: 'Ilova yangilanishi', ru: 'Обновление приложения' },
  'connect.paired.other': { uz: 'Boshqa kassaga ulash', ru: 'Подключить к другой кассе' },
  'connect.theme.title': { uz: 'Mavzu', ru: 'Тема' },
  'connect.theme.system': { uz: 'Tizim', ru: 'Системная' },
  'connect.theme.light': { uz: "Yorug'", ru: 'Светлая' },
  'connect.theme.dark': { uz: "Qorong'i", ru: 'Тёмная' },

  // Tables
  'tables.role': { uz: 'Ofitsiant', ru: 'Официант' },
  'tables.lock': { uz: 'Qulflash', ru: 'Заблокировать' },
  'tables.conn.ok': { uz: 'Kassa bilan aloqa bor', ru: 'Касса на связи' },
  'tables.conn.off': { uz: "Kassa bilan aloqa yo'q", ru: 'Нет связи с кассой' },
  'tables.filter.all': { uz: 'Hammasi', ru: 'Все' },
  'tables.filter.mine': { uz: 'Mening stollarim', ru: 'Мои столы' },
  'tables.you': { uz: 'Siz', ru: 'Вы' },
  'tables.openOnTill': { uz: 'Kassada ochiq', ru: 'Открыт на кассе' },
  'tables.aria.free': { uz: "bo'sh", ru: 'свободен' },
  'tables.aria.openElsewhere': { uz: 'boshqa qurilmada ochiq', ru: 'открыт на другом устройстве' },
  'tables.loading': { uz: 'Stollar yuklanmoqda', ru: 'Загрузка столов' },
  'tables.noShift.title': { uz: 'Smena ochilmagan', ru: 'Смена не открыта' },
  'tables.noShift.body': {
    uz: 'Buyurtma olish uchun kassada smenani oching',
    ru: 'Чтобы принимать заказы, откройте смену на кассе.',
  },
  'tables.offline': { uz: "Aloqa yo'q, qayta ulanmoqda…", ru: 'Нет связи, переподключение…' },
  'tables.empty.title': { uz: "Bu zalda hali stol yo'q", ru: 'В этом зале пока нет столов' },
  'tables.empty.body': {
    uz: "Stollar kassada qo'shiladi. Boshqa zalni tanlang.",
    ru: 'Столы добавляются на кассе. Выберите другой зал.',
  },
  'tables.update.banner': { uz: 'Yangi versiya bor: {version}', ru: 'Доступна новая версия: {version}' },
  'tables.update.cta': { uz: 'Yangilash', ru: 'Обновить' },

  // Order
  'order.menu.moreAria': { uz: 'Boshqa amallar', ru: 'Другие действия' },
  'order.menu.move': { uz: "Stolni ko'chirish", ru: 'Перенести стол' },
  'order.menu.cancel': { uz: 'Buyurtmani bekor qilish', ru: 'Отменить заказ' },
  'order.guestsAria': { uz: 'Mehmonlar: {n}', ru: 'Гостей: {n}' },
  'order.search': { uz: 'Taom qidirish', ru: 'Поиск блюда' },
  'order.category.all': { uz: 'Hammasi', ru: 'Все' },
  'order.stock.left': { uz: 'Qoldi: {n}', ru: 'Осталось: {n}' },
  'order.stock.out': { uz: 'Tugadi', ru: 'Нет в наличии' },
  'order.addAria': { uz: "Qo'shish: {name}", ru: 'Добавить: {name}' },
  'order.cart.openAria': { uz: 'Buyurtmani ochish', ru: 'Открыть заказ' },
  'order.cart.unsavedAria': { uz: "Saqlanmagan o'zgarishlar bor", ru: 'Есть несохранённые изменения' },
  'order.cart.count_one': { uz: '{n} ta taom', ru: '{n} блюдо' },
  'order.cart.count_few': { uz: '{n} ta taom', ru: '{n} блюда' },
  'order.cart.count_many': { uz: '{n} ta taom', ru: '{n} блюд' },
  'order.cart.empty': { uz: "Taom qo'shing", ru: 'Добавьте блюда' },
  'order.save': { uz: 'Saqlash', ru: 'Сохранить' },
  'order.saving': { uz: 'Saqlanmoqda…', ru: 'Сохранение…' },
  'order.saved': { uz: 'Saqlandi, oshxonaga yuborildi', ru: 'Сохранено, отправлено на кухню' },
  'order.sheet.title': { uz: 'Buyurtma · {table}', ru: 'Заказ · {table}' },
  'order.sheet.new': { uz: 'Yangi', ru: 'Новое' },
  'order.sheet.subtotal': { uz: 'Taomlar', ru: 'Блюда' },
  'order.sheet.service': { uz: 'Xizmat haqi {percent}%', ru: 'Обслуживание {percent}%' },
  // F20-W (answer 5): the per-guest service fee.
  'order.sheet.servicePerGuest': {
    uz: 'Xizmat haqi ({n} × {fee})',
    ru: 'Обслуживание ({n} × {fee})',
  },
  'order.sheet.total': { uz: 'Jami', ru: 'Итого' },
  'order.prebill': { uz: 'Oldindan chek', ru: 'Пред-чек' },
  'order.readonly.owner': { uz: "Bu buyurtma {name}'niki.", ru: 'Заказ ведёт {name}.' },
  'order.readonly.only': { uz: 'Faqat oldindan chek chiqarish mumkin.', ru: 'Можно только распечатать пред-чек.' },

  // Sheets and dialogs
  'sheet.portion.subtitle': { uz: 'Porsiyani tanlang', ru: 'Выберите порцию' },
  'sheet.portion.hint': {
    uz: "Tanlash bilan taom buyurtmaga qo'shiladi.",
    ru: 'Блюдо добавится в заказ сразу после выбора.',
  },
  'sheet.weight.aria': { uz: "Og'irlikni kiriting", ru: 'Введите вес' },
  'sheet.guests.title': { uz: 'Mehmonlar soni', ru: 'Количество гостей' },
  'sheet.move.title': { uz: "Stolni ko'chirish", ru: 'Перенести стол' },
  'sheet.move.subtitle': { uz: "Faqat bo'sh stollar ko'rsatilgan", ru: 'Показаны только свободные столы' },
  'sheet.move.confirm': { uz: "{from} → {to} ga ko'chirilsinmi?", ru: 'Перенести {from} → {to}?' },
  'sheet.move.cta': { uz: "Ko'chirish", ru: 'Перенести' },
  'sheet.stock.title': { uz: 'Yetarli emas', ru: 'Недостаточно на складе' },
  'sheet.stock.subtitle': { uz: 'Buyurtma saqlanmadi', ru: 'Заказ не сохранён' },
  'sheet.stock.line': { uz: "so'raldi {asked}, qoldi {left}", ru: 'запрошено {asked}, осталось {left}' },
  'sheet.stock.fix': { uz: 'Tuzatish', ru: 'Исправить' },
  'sheet.stock.hint': {
    uz: '«Tuzatish» miqdorni {left} ga o\'zgartiradi. Keyin qayta saqlang.',
    ru: '«Исправить» поставит количество {left}. Затем сохраните ещё раз.',
  },
  'dialog.cancel.title': { uz: 'Buyurtma bekor qilinsinmi?', ru: 'Отменить заказ?' },
  'dialog.cancel.body': { uz: 'Oshxonaga bekor qilish cheki chiqadi.', ru: 'На кухне распечатается чек отмены.' },
  'dialog.cancel.no': { uz: "Yo'q", ru: 'Нет' },
  // F20-W (answer 6): not "Bekor qilish", which dismisses everywhere else.
  'dialog.cancel.yes': { uz: 'Buyurtmani bekor qilish', ru: 'Отменить заказ' },
  'dialog.unsaved.title': { uz: "Saqlanmagan o'zgarishlar bor", ru: 'Есть несохранённые изменения' },
  'dialog.unsaved.body': {
    uz: '{n} ta yangi taom hali oshxonaga yuborilmagan.',
    ru: 'Новые блюда ещё не отправлены на кухню: {n}.',
  },
  'dialog.unsaved.save': { uz: 'Saqlash', ru: 'Сохранить' },
  'dialog.unsaved.discard': { uz: 'Saqlamasdan chiqish', ru: 'Выйти без сохранения' },
  'dialog.unsaved.stay': { uz: 'Qolish', ru: 'Остаться' },
  'dialog.conflict.title': {
    uz: "Bu buyurtma boshqa qurilmada o'zgartirildi",
    ru: 'Этот заказ изменён на другом устройстве',
  },
  'dialog.conflict.body': { uz: 'Yangilangan holatni yuklang.', ru: 'Загрузите актуальную версию.' },
  'dialog.conflict.cta': { uz: 'Yangilash', ru: 'Обновить' },
  'toast.saveFailed': { uz: "Saqlab bo'lmadi", ru: 'Не удалось сохранить' },
  'toast.prebillSent': { uz: 'Oldindan chek kassaga yuborildi', ru: 'Пред-чек отправлен на кассу' },

  // Update
  'update.title': { uz: 'Ilova yangilanishi', ru: 'Обновление приложения' },
  'update.installed': { uz: "O'rnatilgan versiya {version}", ru: 'Установлена версия {version}' },
  'update.upToDate': { uz: "Eng so'nggi versiya o'rnatilgan", ru: 'Установлена последняя версия' },
  'update.lastCheck': { uz: 'Oxirgi tekshiruv: {when}', ru: 'Последняя проверка: {when}' },
  'update.check': { uz: 'Tekshirish', ru: 'Проверить' },
  'update.available': { uz: 'Yangi versiya: {version}', ru: 'Новая версия: {version}' },
  'update.whatsNew': { uz: 'Nima yangi', ru: 'Что нового' },
  'update.download': { uz: 'Yuklab olish', ru: 'Скачать' },
  'update.later': { uz: 'Keyinroq', ru: 'Позже' },
  'update.downloading': { uz: 'Yuklab olinmoqda… {version}', ru: 'Загрузка… {version}' },
  'update.progress': { uz: '{done} / {total} MB', ru: '{done} / {total} МБ' },
  'update.ready': { uz: "{version} o'rnatishga tayyor", ru: '{version} готова к установке' },
  'update.downloaded': { uz: '{size} MB yuklab olindi', ru: 'Загружено {size} МБ' },
  'update.androidHint': {
    uz: "Android o'rnatish uchun ruxsat so'raydi, «O'rnatish»ni bosing.",
    ru: 'Android запросит разрешение на установку — нажмите «Установить».',
  },
  'update.install': { uz: "O'rnatish", ru: 'Установить' },
  'update.error.title': { uz: "Yuklab bo'lmadi", ru: 'Не удалось скачать' },
  'update.error.body': { uz: 'Internet bormi?', ru: 'Есть ли интернет?' },
  'update.error.stopped': { uz: "{done} / {total} MB da to'xtadi", ru: 'Остановлено на {done} / {total} МБ' },
  'update.error.checksum': {
    uz: "Fayl buzilgan: qayta yuklab oling",
    ru: 'Файл повреждён: скачайте заново',
  },

  // F20-W: states and messages the frames did not draw.
  'common.error': { uz: "Kutilmagan xatolik. Qayta urinib ko'ring", ru: 'Непредвиденная ошибка. Повторите' },
  'common.offline': { uz: "Kassa bilan aloqa yo'q", ru: 'Нет связи с кассой' },
  'common.loading': { uz: 'Yuklanmoqda…', ru: 'Загрузка…' },
  'pin.version.title': { uz: 'Kassa va ilova versiyalari mos emas', ru: 'Версии кассы и приложения не совпадают' },
  'pin.version.body': { uz: 'Ilovani yangilang', ru: 'Обновите приложение' },
  'pin.unpaired.revoked': {
    uz: 'Bu telefon kassada uzilgan. Qayta ulang.',
    ru: 'Этот телефон отключён на кассе. Подключите заново.',
  },
  'connect.error.limit.title': { uz: "Telefonlar soni to'lgan", ru: 'Лимит телефонов исчерпан' },
  'connect.error.wrongKind': {
    uz: "Bu kod kassa uchun. Kassada «Telefon qo'shish»ni bosing",
    ru: 'Этот код для кассы. На кассе нажмите «Добавить телефон»',
  },
  'connect.error.throttled': {
    uz: "Ko'p marta noto'g'ri kod. 10 daqiqadan keyin urinib ko'ring",
    ru: 'Слишком много неверных кодов. Повторите через 10 минут',
  },
  'connect.error.badQr': {
    uz: 'Bu SavdoChef kassasining QR kodi emas',
    ru: 'Это не QR-код кассы SavdoChef',
  },
  'connect.forgetConfirm': {
    uz: "Bu telefon hozirgi kassadan uziladi. Davom etilsinmi?",
    ru: 'Телефон будет отключён от текущей кассы. Продолжить?',
  },
  'order.lockedElsewhere': {
    uz: 'Bu stol hozir boshqa qurilmada ochiq. Faqat oldindan chek mumkin.',
    ru: 'Стол сейчас открыт на другом устройстве. Можно только пред-чек.',
  },
  'order.noShift': { uz: 'Smena ochilmagan', ru: 'Смена не открыта' },
  'toast.moved': { uz: "{table} ga ko'chirildi", ru: 'Перенесено: {table}' },
  'toast.cancelled': { uz: 'Buyurtma bekor qilindi', ru: 'Заказ отменён' },
  'toast.guestsSaved': { uz: 'Mehmonlar soni saqlandi', ru: 'Количество гостей сохранено' },
} as const satisfies Record<string, Record<Locale, string>>;

export type StringKey = keyof typeof strings;
