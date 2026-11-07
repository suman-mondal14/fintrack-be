/**
 * Canonical Expense Categories Master List
 * Used by Gemini AI classification, backend normalization, and frontend dropdowns/filters
 */
const EXPENSE_CATEGORIES = [
  {
    id: 'Groceries',
    label: 'Groceries & Daily Essentials',
    description: 'Supermarkets, kirana, daily essentials, milk, vegetables (e.g. Apna Mart, DMart, Blinkit, Zepto, BigBasket)',
    color: '#06b6d4',
    icon: 'shopping-cart',
    keywords: [
      'apna mart', 'mart', 'dmart', 'blinkit', 'zepto', 'bigbasket', 'instamart',
      'kirana', 'supermarket', 'grocery', 'vegetable', 'fruit', 'dairy', 'milk',
      'bread', 'ration', 'spencer', 'more retail', 'provisions'
    ]
  },
  {
    id: 'Food & Dining',
    label: 'Food & Dining',
    description: 'Restaurants, food delivery, cafes, bakeries (e.g. Swiggy, Zomato, Starbucks, Domino\'s, McDonald\'s)',
    color: '#10b981',
    icon: 'utensils',
    keywords: [
      'swiggy', 'zomato', 'restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald',
      'kfc', 'domino', 'pizza', 'burger', 'dhaba', 'food', 'bakery', 'chai', 'tea',
      'bistro', 'eats', 'barbeque'
    ]
  },
  {
    id: 'Entertainment',
    label: 'Entertainment & OTT',
    description: 'Movies, tickets, streaming, gaming, events (e.g. BookMyShow, PVR, INOX, Netflix, Spotify, Prime Video)',
    color: '#8b5cf6',
    icon: 'film',
    keywords: [
      'bookmyshow', 'book my show', 'pvr', 'inox', 'cinema', 'movie', 'theatre',
      'netflix', 'spotify', 'prime video', 'hotstar', 'youtube', 'concert', 'gaming',
      'steam', 'playstation', 'events', 'show'
    ]
  },
  {
    id: 'Shopping',
    label: 'Shopping & Lifestyle',
    description: 'E-commerce, apparel, electronics, gadgets (e.g. Amazon, Flipkart, Myntra, Meesho, Ajio, Croma, Zara)',
    color: '#f59e0b',
    icon: 'shopping-bag',
    keywords: [
      'amazon', 'flipkart', 'myntra', 'meesho', 'ajio', 'nykaa', 'tata cliq',
      'zara', 'h&m', 'retail', 'clothing', 'apparel', 'electronics', 'croma',
      'reliance digital', 'shopping', 'lifestyle'
    ]
  },
  {
    id: 'Bills & Utilities',
    label: 'Bills & Utilities',
    description: 'Electricity, water, gas, Wi-Fi, recharge (e.g. Jio, Airtel, Vi, BESCOM, Adani, Tata Play)',
    color: '#6366f1',
    icon: 'zap',
    keywords: [
      'electricity', 'power', 'water', 'gas', 'cylinder', 'wifi', 'broadband',
      'airtel', 'jio', 'vi', 'vodafone', 'bsnl', 'recharge', 'dth', 'tata play',
      'maintenance', 'bill', 'utility'
    ]
  },
  {
    id: 'Transport',
    label: 'Transport & Fuel',
    description: 'Cab, auto, fuel, transit, tickets (e.g. Uber, Ola, Rapido, Petrol, IndianOil, HP, Metro, IRCTC, Flight)',
    color: '#0ea5e9',
    icon: 'car',
    keywords: [
      'uber', 'ola', 'rapido', 'petrol', 'diesel', 'fuel', 'cng', 'indianoil',
      'hp petrol', 'bharat petroleum', 'shell', 'fastag', 'toll', 'metro',
      'irctc', 'railway', 'flight', 'makemytrip', 'redbus', 'travel'
    ]
  },
  {
    id: 'Health',
    label: 'Health & Medical',
    description: 'Medicines, clinics, hospitals, diagnostics (e.g. Apollo, Netmeds, Tata 1mg, PharmEasy, Doctor, Lab)',
    color: '#f43f5e',
    icon: 'heart-pulse',
    keywords: [
      'apollo', 'pharmacy', 'chemist', 'medical', 'meds', '1mg', 'netmeds',
      'pharmeasy', 'hospital', 'clinic', 'doctor', 'diagnostics', 'lab',
      'pathology', 'medicine'
    ]
  },
  {
    id: 'Education',
    label: 'Education & Learning',
    description: 'Tuition, school, college, courses, books (e.g. Udemy, Coursera, Coaching, Exam fees)',
    color: '#3b82f6',
    icon: 'book-open',
    keywords: [
      'school', 'college', 'university', 'tuition', 'classes', 'udemy',
      'coursera', 'books', 'stationery', 'coaching', 'exam fee', 'course'
    ]
  },
  {
    id: 'Personal',
    label: 'Personal / P2P Transfer',
    description: 'Direct P2P transfers to individual persons, friends, or family without a business/merchant name',
    color: '#ec4899',
    icon: 'user',
    keywords: [
      'p2p', 'friend', 'family', 'transfer', 'sent to', 'received from', 'personal transfer'
    ]
  },
  {
    id: 'Others',
    label: 'Others',
    description: 'Miscellaneous or uncategorized transactions',
    color: '#64748b',
    icon: 'more-horizontal',
    keywords: [
      'other', 'misc', 'general', 'charges', 'fee', 'donation'
    ]
  }
];

/**
 * Smart normalizer that checks merchant name keywords and Gemini output
 * to guarantee accurate category placement.
 * @param {string} title - Merchant/Recipient title
 * @param {string} detectedCategory - Category returned by AI
 * @returns {string} Standardized category ID
 */
const normalizeCategory = (title = '', detectedCategory = '') => {
  const cleanTitle = (title || '').toLowerCase().trim();
  const cleanCategory = (detectedCategory || '').toLowerCase().trim();

  // 1. Direct keyword match against title (e.g. "Apna Mart", "BookMyShow", "Swiggy")
  for (const cat of EXPENSE_CATEGORIES) {
    if (cat.id === 'Others' || cat.id === 'Personal') continue;
    for (const kw of cat.keywords) {
      if (cleanTitle.includes(kw)) {
        return cat.id;
      }
    }
  }

  // 2. Exact match against known category IDs or common synonyms
  const synonymMap = {
    'grocery': 'Groceries',
    'groceries': 'Groceries',
    'food': 'Food & Dining',
    'dining': 'Food & Dining',
    'food & dining': 'Food & Dining',
    'pocket money': 'Food & Dining',
    'entertainment': 'Entertainment',
    'movie': 'Entertainment',
    'shopping': 'Shopping',
    'wish shopping': 'Shopping',
    'utilities': 'Bills & Utilities',
    'bills': 'Bills & Utilities',
    'bills & utilities': 'Bills & Utilities',
    'transport': 'Transport',
    'travel': 'Transport',
    'fuel': 'Transport',
    'health': 'Health',
    'medical': 'Health',
    'healthcare': 'Health',
    'education': 'Education',
    'personal': 'Personal',
    'p2p': 'Personal',
    'others': 'Others',
    'other': 'Others'
  };

  if (synonymMap[cleanCategory]) {
    return synonymMap[cleanCategory];
  }

  // 3. Match against category keywords using detected category
  for (const cat of EXPENSE_CATEGORIES) {
    for (const kw of cat.keywords) {
      if (cleanCategory.includes(kw)) {
        return cat.id;
      }
    }
  }

  // 4. Default: If a person's name or personal transfer is detected without a merchant, keep Personal
  if (cleanCategory.includes('personal') || cleanCategory.includes('transfer')) {
    return 'Personal';
  }

  return 'Others';
};

module.exports = {
  EXPENSE_CATEGORIES,
  normalizeCategory
};

