import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  ExternalLink,
  Trash2,
  CheckCircle2,
  Circle,
  Link as LinkIcon,
  Search,
  Sparkles,
  ClipboardPaste,
  Loader2,
  X,
  Camera,
  Upload,
  Edit3,
  Truck,
  ChevronDown,
  Check,
  Image as ImageIcon
} from 'lucide-react';
import {
  db,
  addShoppingItem,
  updateShoppingItem,
  deleteShoppingItem,
  type ShoppingItem
} from '../db';
import { fetchLinkMetadata } from '../utils/linkPreview';
import { p2pSyncManager } from '../utils/p2pSync';

export function ShoppingWishlistView() {
  const items = useLiveQuery(() => db.shoppingItems.orderBy('createdAt').reverse().toArray(), []);

  const [inputUrl, setInputUrl] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'unbought' | 'ordered' | 'bought'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'priceAsc' | 'priceDesc'>('date');

  // Fields for the Add/Review Modal
  const [modalUrl, setModalUrl] = useState('');
  const [modalTitle, setModalTitle] = useState('');
  const [modalDescription, setModalDescription] = useState('');
  const [modalImageUrl, setModalImageUrl] = useState('');
  const [modalPrice, setModalPrice] = useState('');
  const [modalCurrency, setModalCurrency] = useState('UAH');
  const [modalDomain, setModalDomain] = useState('');
  const [modalPriority, setModalPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [modalNotes, setModalNotes] = useState('');
  const [modalStatus, setModalStatus] = useState<'planned' | 'ordered' | 'bought'>('planned');
  const [modalOrderPlace, setModalOrderPlace] = useState('');
  const [modalDepositAmount, setModalDepositAmount] = useState('');

  // Editing existing item or adding image specifically
  const [editingItem, setEditingItem] = useState<ShoppingItem | null>(null);
  const [editImageUrl, setEditImageUrl] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editStatus, setEditStatus] = useState<'planned' | 'ordered' | 'bought'>('planned');
  const [editOrderPlace, setEditOrderPlace] = useState('');
  const [editDepositAmount, setEditDepositAmount] = useState('');

  // Dropdown status menu id for card
  const [activeStatusMenuId, setActiveStatusMenuId] = useState<number | null>(null);

  // Financial summary
  const budgetStats = useMemo(() => {
    if (!items || items.length === 0) {
      return { total: 0, bought: 0, deposits: 0, remaining: 0 };
    }

    let total = 0;
    let bought = 0;
    let deposits = 0;

    for (const it of items) {
      const price = it.price || 0;
      total += price;
      if (it.isBought || it.status === 'bought') {
        bought += price;
      } else if (it.depositAmount) {
        deposits += it.depositAmount;
      }
    }

    return {
      total,
      bought,
      deposits,
      remaining: Math.max(0, total - bought - deposits)
    };
  }, [items]);

  // Handle URL fetch & preview
  const handleFetchUrl = async (urlToFetch?: string) => {
    const url = (urlToFetch || inputUrl).trim();
    if (!url) return;

    setIsLoadingPreview(true);
    try {
      const meta = await fetchLinkMetadata(url);

      setModalUrl(meta.url);
      setModalTitle(meta.title);
      setModalDescription(meta.description || '');
      setModalImageUrl(meta.imageUrl || '');
      setModalPrice(meta.price ? meta.price.toString() : '');
      setModalCurrency(meta.currency || 'UAH');
      setModalDomain(meta.domain);
      setModalPriority('medium');
      setModalNotes('');

      setInputUrl('');
      setShowAddModal(true);
    } catch (err) {
      console.error('Failed to parse URL:', err);
      // Open modal anyway for manual typing
      setModalUrl(url);
      setModalTitle('Новий товар');
      setShowAddModal(true);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Paste from clipboard
  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.includes('.'))) {
          setInputUrl(text);
          await handleFetchUrl(text);
          return;
        }
      }
    } catch {
      // Clipboard permission denied or unavailable
    }
  };

  // Save new shopping item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTitle.trim()) return;

    const isItemBought = modalStatus === 'bought';
    const id = await addShoppingItem({
      url: modalUrl || '#',
      domain: modalDomain || 'магазин',
      title: modalTitle.trim(),
      description: modalDescription.trim() || undefined,
      imageUrl: modalImageUrl.trim() || undefined,
      price: modalPrice ? parseFloat(modalPrice) : undefined,
      currency: modalCurrency,
      isBought: isItemBought,
      status: modalStatus,
      orderPlace: modalOrderPlace.trim() || undefined,
      depositAmount: modalDepositAmount ? parseFloat(modalDepositAmount) : undefined,
      priority: modalPriority,
      notes: modalNotes.trim() || undefined
    });

    const added = await db.shoppingItems.get(id);
    if (added) p2pSyncManager.broadcastShoppingItem(added);

    setShowAddModal(false);
  };

  // Helper to convert an uploaded image file (from camera or library) to base64 DataURL
  const handleImageFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    onDone: (base64Url: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Optional client-side image compression via canvas
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 600;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        onDone(dataUrl);
      };
      if (typeof event.target?.result === 'string') {
        img.src = event.target.result;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleOpenEdit = (item: ShoppingItem) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditImageUrl(item.imageUrl || '');
    setEditPrice(item.price ? item.price.toString() : '');
    setEditStatus(item.status || (item.isBought ? 'bought' : 'planned'));
    setEditOrderPlace(item.orderPlace || '');
    setEditDepositAmount(item.depositAmount ? item.depositAmount.toString() : '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem?.id || !editTitle.trim()) return;

    const isBought = editStatus === 'bought';
    await updateShoppingItem(editingItem.id, {
      title: editTitle.trim(),
      imageUrl: editImageUrl.trim() || undefined,
      price: editPrice ? parseFloat(editPrice) : undefined,
      status: editStatus,
      isBought,
      orderPlace: editOrderPlace.trim() || undefined,
      depositAmount: editDepositAmount ? parseFloat(editDepositAmount) : undefined
    });

    const updated = await db.shoppingItems.get(editingItem.id);
    if (updated) p2pSyncManager.broadcastShoppingItem(updated);

    setEditingItem(null);
  };

  const handleSetItemStatus = async (item: ShoppingItem, nextStatus: 'planned' | 'ordered' | 'bought') => {
    if (!item.id) return;
    if ('vibrate' in navigator) navigator.vibrate([25]);

    await updateShoppingItem(item.id, {
      status: nextStatus,
      isBought: nextStatus === 'bought'
    });

    const updated = await db.shoppingItems.get(item.id);
    if (updated) p2pSyncManager.broadcastShoppingItem(updated);

    setActiveStatusMenuId(null);
  };

  // Filter and Sort Items
  const displayedItems = useMemo(() => {
    if (!items) return [];

    let list = [...items];

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        i =>
          i.title.toLowerCase().includes(q) ||
          i.domain.toLowerCase().includes(q) ||
          (i.orderPlace && i.orderPlace.toLowerCase().includes(q)) ||
          (i.notes && i.notes.toLowerCase().includes(q))
      );
    }

    // Filter
    if (filterStatus === 'unbought') {
      list = list.filter(i => (i.status || (i.isBought ? 'bought' : 'planned')) === 'planned');
    } else if (filterStatus === 'ordered') {
      list = list.filter(i => i.status === 'ordered');
    } else if (filterStatus === 'bought') {
      list = list.filter(i => i.isBought || i.status === 'bought');
    }

    // Sort
    if (sortBy === 'priceAsc') {
      list.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (sortBy === 'priceDesc') {
      list.sort((a, b) => (b.price || 0) - (a.price || 0));
    } else {
      list.sort((a, b) => b.createdAt - a.createdAt);
    }

    return list;
  }, [items, searchQuery, filterStatus, sortBy]);

  const formatMoney = (val: number, cur = '₴') => {
    return `${val.toLocaleString('uk-UA')} ${cur === 'UAH' ? '₴' : cur}`;
  };

  return (
    <div className="max-w-md mx-auto px-4 space-y-4">
      {/* FINANCIAL SUMMARY / BUDGET CARD */}
      <div className="bg-gradient-to-tr from-rose-500 via-pink-500 to-rose-600 rounded-3xl p-5 text-white shadow-md shadow-rose-500/20">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-rose-100 uppercase tracking-wider block">
              Бюджет покупок
            </span>
            <h2 className="text-2xl font-black tracking-tight mt-0.5">
              {formatMoney(budgetStats.total)}
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-rose-100 font-medium block">
              Куплено: {formatMoney(budgetStats.bought)}
            </span>
            {budgetStats.deposits > 0 && (
              <span className="text-[10px] text-amber-200 block">
                Завдатки: {formatMoney(budgetStats.deposits)}
              </span>
            )}
            <span className="text-[10px] text-rose-200 block">
              До сплати: {formatMoney(budgetStats.remaining)}
            </span>
          </div>
        </div>

        {budgetStats.total > 0 && (
          <div className="w-full bg-white/25 rounded-full h-2.5 mt-4 overflow-hidden">
            <div
              className="bg-white h-2.5 rounded-full transition-all duration-300 shadow-sm"
              style={{
                width: `${Math.min(100, Math.round((budgetStats.bought / budgetStats.total) * 100))}%`
              }}
            />
          </div>
        )}
      </div>

      {/* QUICK URL INPUT & SCRAPER BAR */}
      <div className="bg-white dark:bg-zinc-900 p-2.5 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-xs flex items-center space-x-2">
        <LinkIcon className="w-4 h-4 text-gray-400 ml-1.5 shrink-0" />
        <input
          type="url"
          placeholder="Вставте посилання на товар..."
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleFetchUrl()}
          className="flex-1 text-xs font-medium bg-transparent border-none focus:outline-none placeholder-gray-400 text-gray-800 dark:text-gray-200"
        />

        {inputUrl ? (
          <button
            type="button"
            onClick={() => handleFetchUrl()}
            disabled={isLoadingPreview}
            className="px-3 py-1.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-sm shadow-rose-500/20 active:scale-95 transition flex items-center space-x-1"
          >
            {isLoadingPreview ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>Додати</span>
          </button>
        ) : (
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={handlePasteClipboard}
              className="p-1.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 text-xs font-semibold flex items-center space-x-1"
              title="Вставити з буфера"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span className="text-[11px]">Вставити</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setModalUrl('');
                setModalTitle('');
                setModalDescription('');
                setModalImageUrl('');
                setModalPrice('');
                setModalDomain('магазин');
                setShowAddModal(true);
              }}
              className="p-1.5 rounded-xl bg-rose-50 dark:bg-rose-950 text-rose-600 dark:text-rose-400 hover:bg-rose-100"
              title="Створити вручну"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* SEARCH, FILTERS & SORT */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Пошук серед покупок..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl text-xs font-medium placeholder-gray-400 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                filterStatus === 'all'
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              Всі
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('unbought')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                filterStatus === 'unbought'
                  ? 'bg-rose-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              У планах
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('ordered')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                filterStatus === 'ordered'
                  ? 'bg-amber-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              Замовлено 📦
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus('bought')}
              className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
                filterStatus === 'bought'
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              Куплено
            </button>
          </div>

          <div className="flex items-center space-x-1">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-[11px] font-semibold bg-transparent text-gray-500 border border-gray-200 dark:border-zinc-800 rounded-lg px-2 py-1 focus:outline-none"
            >
              <option value="date">Нові</option>
              <option value="priceAsc">Дешевші</option>
              <option value="priceDesc">Дорожчі</option>
            </select>
          </div>
        </div>
      </div>

      {/* SHOPPING ITEMS LIST */}
      <div className="space-y-3">
        {displayedItems.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-400 text-sm">
            {searchQuery
              ? 'Нічого не знайдено за вашим запитом.'
              : filterStatus === 'unbought'
              ? '🎉 Усі заплановані покупки вже здійснено!'
              : 'Список покупок порожній. Вставте посилання або додайте вручну!'}
          </div>
        ) : (
          displayedItems.map((item) => {
            const priorityColor =
              item.priority === 'high'
                ? 'bg-rose-500'
                : item.priority === 'low'
                ? 'bg-gray-400'
                : 'bg-amber-500';

            const currentStatus = item.status || (item.isBought ? 'bought' : 'planned');

            return (
              <div
                key={item.id}
                className={`p-3.5 rounded-2xl border transition-all duration-150 bg-white dark:bg-zinc-900 ${
                  item.isBought
                    ? 'border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10'
                    : 'border-gray-100 dark:border-zinc-800 shadow-xs'
                }`}
              >
                <div className="flex items-start space-x-3">
                  {/* Item Image or Placeholder */}
                  <div className="w-18 h-18 rounded-xl bg-gray-100 dark:bg-zinc-800 overflow-hidden shrink-0 border border-gray-200/60 dark:border-zinc-700/60 flex items-center justify-center relative">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <ImageIcon className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                    )}

                    {/* Priority Dot */}
                    <div
                      className={`absolute top-1.5 left-1.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-zinc-900 ${priorityColor}`}
                      title={`Пріоритет: ${item.priority}`}
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                        {item.domain}
                      </span>
                      {item.price !== undefined && (
                        <span className="font-extrabold text-sm text-rose-600 dark:text-rose-400">
                          {formatMoney(item.price, item.currency)}
                        </span>
                      )}
                    </div>

                    <h4
                      className={`text-sm font-bold text-gray-900 dark:text-white leading-snug line-clamp-2 mt-0.5 ${
                        item.isBought ? 'line-through opacity-70' : ''
                      }`}
                    >
                      {item.title}
                    </h4>

                    {item.notes && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-1">
                        {item.notes}
                      </p>
                    )}

                    {/* Order & Deposit Badges */}
                    {(item.status === 'ordered' || item.orderPlace || item.depositAmount) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {item.status === 'ordered' && (
                          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-bold text-[10px] border border-amber-200/50 dark:border-amber-800/40">
                            <Truck className="w-3 h-3" />
                            <span>Замовлено</span>
                          </span>
                        )}
                        {item.orderPlace && (
                          <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-md">
                            📍 {item.orderPlace}
                          </span>
                        )}
                        {item.depositAmount !== undefined && item.depositAmount > 0 && (
                          <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded-md border border-indigo-200/40">
                            Завдаток: {formatMoney(item.depositAmount, item.currency)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Action buttons row with explicit Status Selector */}
                    <div className="mt-2.5 flex items-center justify-between pt-1 border-t border-gray-100 dark:border-zinc-800/80">
                      {/* Explicit Status Selector with Dropdown */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveStatusMenuId(activeStatusMenuId === item.id ? null : (item.id || null))}
                          className={`flex items-center space-x-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-xl border transition active:scale-95 ${
                            currentStatus === 'bought'
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/50'
                              : currentStatus === 'ordered'
                              ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/50'
                              : 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'
                          }`}
                          title="Змінити статус товару"
                        >
                          {currentStatus === 'bought' ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 fill-emerald-50 shrink-0" />
                              <span>Куплено</span>
                            </>
                          ) : currentStatus === 'ordered' ? (
                            <>
                              <Truck className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                              <span>Замовлено</span>
                            </>
                          ) : (
                            <>
                              <Circle className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>У планах</span>
                            </>
                          )}
                          <ChevronDown className="w-3 h-3 text-gray-400 ml-0.5" />
                        </button>

                        {/* Dropdown Menu for selecting status explicitly */}
                        {activeStatusMenuId === item.id && (
                          <>
                            <div
                              className="fixed inset-0 z-20"
                              onClick={() => setActiveStatusMenuId(null)}
                            />
                            <div className="absolute left-0 top-full mt-1 w-44 bg-white dark:bg-zinc-900 border border-gray-150 dark:border-zinc-700 rounded-2xl shadow-xl z-30 py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                            <span className="block px-3 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-zinc-800">
                              Змінити статус:
                            </span>

                            <button
                              type="button"
                              onClick={() => handleSetItemStatus(item, 'planned')}
                              className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center justify-between transition hover:bg-gray-50 dark:hover:bg-zinc-800 ${
                                currentStatus === 'planned' ? 'text-rose-500 font-bold bg-rose-50/50 dark:bg-rose-950/20' : 'text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <Circle className="w-3.5 h-3.5 text-gray-400" />
                                <span>У планах (шукаємо)</span>
                              </div>
                              {currentStatus === 'planned' && <Check className="w-3.5 h-3.5 text-rose-500" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSetItemStatus(item, 'ordered')}
                              className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center justify-between transition hover:bg-gray-50 dark:hover:bg-zinc-800 ${
                                currentStatus === 'ordered' ? 'text-amber-600 font-bold bg-amber-50/50 dark:bg-amber-950/20' : 'text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <Truck className="w-3.5 h-3.5 text-amber-500" />
                                <span>Замовлено (в дорозі)</span>
                              </div>
                              {currentStatus === 'ordered' && <Check className="w-3.5 h-3.5 text-amber-600" />}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleSetItemStatus(item, 'bought')}
                              className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center justify-between transition hover:bg-gray-50 dark:hover:bg-zinc-800 ${
                                currentStatus === 'bought' ? 'text-emerald-600 font-bold bg-emerald-50/50 dark:bg-emerald-950/20' : 'text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                <span>Куплено (вже є)</span>
                              </div>
                              {currentStatus === 'bought' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                      <div className="flex items-center space-x-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="p-1.5 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
                          title="Змінити фото або деталі"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        {item.url && item.url !== '#' && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
                            title="Відкрити магазин"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (item.id) {
                              p2pSyncManager.broadcastDeletedShoppingItem(item.title);
                              await deleteShoppingItem(item.id);
                            }
                          }}
                          className="p-1.5 text-gray-300 hover:text-rose-500 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800 transition"
                          title="Видалити"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ADD / REVIEW PRODUCT MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Новий товар у список
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-3">
              {/* Image Preview & Upload Buttons */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500">Фотографія товару:</label>
                {modalImageUrl ? (
                  <div className="w-full h-36 rounded-2xl bg-gray-100 dark:bg-zinc-800 overflow-hidden relative border border-gray-200 dark:border-zinc-700">
                    <img
                      src={modalImageUrl}
                      alt="Прев'ю"
                      className="w-full h-full object-contain p-2"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={() => setModalImageUrl('')}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                      title="Видалити фото"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <label className="flex-1 py-2 px-3 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer text-gray-700 dark:text-gray-200 active:scale-95 transition">
                        <Upload className="w-4 h-4 text-rose-500" />
                        <span>Завантажити фото</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageFileUpload(e, setModalImageUrl)}
                          className="hidden"
                        />
                      </label>
                      <label className="py-2 px-3 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer text-gray-700 dark:text-gray-200 active:scale-95 transition">
                        <Camera className="w-4 h-4 text-rose-500" />
                        <span className="hidden sm:inline">Камера</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleImageFileUpload(e, setModalImageUrl)}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <input
                      type="url"
                      placeholder="Або вставте пряме посилання на картинку (https://...jpg)"
                      value={modalImageUrl}
                      onChange={(e) => setModalImageUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-medium text-gray-600 dark:text-gray-300"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Назва товару:</label>
                <input
                  type="text"
                  value={modalTitle}
                  onChange={(e) => setModalTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Ціна:</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="1299"
                    value={modalPrice}
                    onChange={(e) => setModalPrice(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Валюта:</label>
                  <select
                    value={modalCurrency}
                    onChange={(e) => setModalCurrency(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  >
                    <option value="UAH">₴ UAH</option>
                    <option value="USD">$ USD</option>
                    <option value="EUR">€ EUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Статус товару:</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalStatus('planned')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      modalStatus === 'planned'
                        ? 'border-gray-800 bg-gray-800 text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    У планах
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalStatus('ordered')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      modalStatus === 'ordered'
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Замовлено 📦
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalStatus('bought')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      modalStatus === 'bought'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Куплено ✓
                  </button>
                </div>
              </div>

              {/* Order Place & Deposit (Shown when Ordered or Planned) */}
              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl space-y-2.5">
                <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
                  Деталі замовлення (якщо оформлено)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      Де замовили:
                    </label>
                    <input
                      type="text"
                      placeholder="Instagram, Rozetka..."
                      value={modalOrderPlace}
                      onChange={(e) => setModalOrderPlace(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      Сума завдатку ({modalCurrency}):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="напр. 500"
                      value={modalDepositAmount}
                      onChange={(e) => setModalDepositAmount(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Пріоритет:</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['high', 'medium', 'low'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setModalPriority(p)}
                      className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                        modalPriority === p
                          ? 'border-rose-500 bg-rose-500 text-white'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {p === 'high' ? 'Високий' : p === 'medium' ? 'Середній' : 'Низький'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Особисті нотатки (колір, розмір, промокод):
                </label>
                <input
                  type="text"
                  placeholder="напр. Розмір 62, сірий колір"
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">URL посилання:</label>
                <input
                  type="url"
                  value={modalUrl}
                  onChange={(e) => setModalUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-mono text-gray-500"
                />
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  Зберегти
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT EXISTING ITEM / ADD PHOTO MODAL */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Редагувати товар
                </h3>
                <span className="text-[11px] text-gray-400 font-medium">
                  {editingItem.domain}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3.5">
              {/* Photo Area */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500">
                  Фотографія товару:
                </label>
                {editImageUrl ? (
                  <div className="w-full h-36 rounded-2xl bg-gray-100 dark:bg-zinc-800 overflow-hidden relative border border-gray-200 dark:border-zinc-700">
                    <img
                      src={editImageUrl}
                      alt="Прев'ю"
                      className="w-full h-full object-contain p-2"
                      referrerPolicy="no-referrer"
                    />
                    <button
                      type="button"
                      onClick={() => setEditImageUrl('')}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                      title="Видалити фото"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <label className="flex-1 py-2.5 px-3 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer text-gray-700 dark:text-gray-200 active:scale-95 transition">
                        <Upload className="w-4 h-4 text-rose-500" />
                        <span>Завантажити фото</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handleImageFileUpload(e, setEditImageUrl)}
                          className="hidden"
                        />
                      </label>
                      <label className="py-2.5 px-3 rounded-xl bg-gray-100 dark:bg-zinc-800 hover:bg-gray-200 dark:hover:bg-zinc-700 border border-gray-200 dark:border-zinc-700 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer text-gray-700 dark:text-gray-200 active:scale-95 transition">
                        <Camera className="w-4 h-4 text-rose-500" />
                        <span className="hidden sm:inline">Камера</span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => handleImageFileUpload(e, setEditImageUrl)}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <input
                      type="url"
                      placeholder="Вставте URL-картинки (https://...)"
                      value={editImageUrl}
                      onChange={(e) => setEditImageUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-medium text-gray-600 dark:text-gray-300"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Назва товару:
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Ціна ({editingItem.currency}):
                </label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="Ціна"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Статус товару:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditStatus('planned')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      editStatus === 'planned'
                        ? 'border-gray-800 bg-gray-800 text-white dark:border-white dark:bg-white dark:text-black'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    У планах
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditStatus('ordered')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      editStatus === 'ordered'
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Замовлено 📦
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditStatus('bought')}
                    className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                      editStatus === 'bought'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    Куплено ✓
                  </button>
                </div>
              </div>

              {/* Order Place & Deposit Area */}
              <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl space-y-2.5">
                <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
                  Деталі замовлення
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      Де замовили:
                    </label>
                    <input
                      type="text"
                      placeholder="Instagram, Rozetka..."
                      value={editOrderPlace}
                      onChange={(e) => setEditOrderPlace(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-400 mb-0.5">
                      Сума завдатку ({editingItem.currency}):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="напр. 500"
                      value={editDepositAmount}
                      onChange={(e) => setEditDepositAmount(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-xs font-semibold"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  Зберегти зміни
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
