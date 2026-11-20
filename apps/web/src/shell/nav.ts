/** Verified public showcase cited by the project brief. */
export const SHOWCASE_URL = "https://rnd.mts.ru/personal";

export type NavLink = {
  label: string;
  href?: string;
  demo?: boolean;
};

export type NavMenu = {
  id: string;
  label: string;
  description: string;
  items: NavLink[];
};

export const brandLabel = "goida-code · Кейс МТС";

export const audienceMenus: NavMenu[] = [
  {
    id: "private",
    label: "Частным лицам",
    description: "Раздел частным лицам открыт как демонстрация навигации.",
    items: [
      { label: "Тарифы", demo: true },
      { label: "Услуги связи", demo: true },
      { label: "Подключение", demo: true },
    ],
  },
  {
    id: "business",
    label: "Бизнесу",
    description: "Раздел для бизнеса открыт как демонстрация навигации.",
    items: [
      { label: "Корпоративные тарифы", demo: true },
      { label: "Облачные сервисы", demo: true },
      { label: "Отраслевые решения", demo: true },
    ],
  },
  {
    id: "more",
    label: "Ещё",
    description: "Дополнительные аудитории портала.",
    items: [
      { label: "О компании", demo: true },
      { label: "Госзаказчикам", demo: true },
      { label: "Партнёрам", demo: true },
      { label: "Инвесторам", demo: true },
    ],
  },
];

export const regionMenu: NavMenu = {
  id: "region",
  label: "Ростовская область",
  description: "Регион прототипа. Смена города не выполняет переход.",
  items: [
    { label: "Ростов-на-Дону", demo: true },
    { label: "Таганрог", demo: true },
    { label: "Шахты", demo: true },
    { label: "Волгодонск", demo: true },
  ],
};

export const catalogMenus: NavMenu[] = [
  {
    id: "mobile",
    label: "Мобильная связь",
    description: "Короткие пункты раздела связи.",
    items: [
      { label: "Тарифы", demo: true },
      { label: "eSIM", demo: true },
      { label: "Роуминг", demo: true },
    ],
  },
  {
    id: "home",
    label: "Для дома",
    description: "Интернет и телевидение для дома.",
    items: [
      { label: "Домашний интернет", demo: true },
      { label: "Телевидение", demo: true },
      { label: "Комплекты услуг", demo: true },
    ],
  },
  {
    id: "finance",
    label: "Оплата и финансы",
    description: "Финансовые действия показаны как демонстрация.",
    items: [
      { label: "Пополнить счёт", demo: true },
      { label: "Обещанный платёж", demo: true },
      { label: "Автоплатёж", demo: true },
    ],
  },
  {
    id: "shop",
    label: "Интернет-магазин",
    description: "Витрина магазина в прототипе не подключена.",
    items: [
      { label: "Смартфоны", demo: true },
      { label: "Аксессуары", demo: true },
    ],
  },
  {
    id: "services",
    label: "Сервисы",
    description: "Развлекательные и цифровые сервисы.",
    items: [
      { label: "Развлекательные сервисы", demo: true },
      { label: "Цифровые сервисы", demo: true },
      { label: "Подписки", demo: true },
    ],
  },
  {
    id: "support",
    label: "Поддержка",
    description: "Справка и обращения в демонстрационном режиме.",
    items: [
      { label: "Помощь", demo: true },
      { label: "Офисы", demo: true },
      { label: "Обращение", demo: true },
    ],
  },
];

export const footerMenus: NavMenu[] = [
  {
    id: "footer-connection",
    label: "Связь и дом",
    description: "Нижний раздел связи и дома.",
    items: [
      { label: "Мобильная связь", demo: true },
      { label: "Домашний интернет", demo: true },
      { label: "Телевидение", demo: true },
    ],
  },
  {
    id: "footer-services",
    label: "Сервисы",
    description: "Нижний раздел сервисов.",
    items: [
      { label: "Цифровые сервисы", demo: true },
      { label: "Подписки", demo: true },
    ],
  },
  {
    id: "footer-support",
    label: "Поддержка",
    description: "Нижний раздел поддержки.",
    items: [
      { label: "Помощь", demo: true },
      { label: "Офисы", demo: true },
    ],
  },
  {
    id: "footer-docs",
    label: "Документы",
    description: "Нижний раздел документов.",
    items: [
      { label: "Условия использования", demo: true },
      { label: "Конфиденциальность", demo: true },
    ],
  },
  {
    id: "footer-about",
    label: "О проекте",
    description: "Сведения о прототипе и публичная витрина.",
    items: [
      { label: "Публичная витрина", href: SHOWCASE_URL },
      { label: "Команда goida-code", demo: true },
    ],
  },
];
