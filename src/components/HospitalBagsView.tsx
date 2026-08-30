import { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles,
  Heart,
  Baby,
  CheckCircle2,
  Circle,
  Plus,
  Minus,
  Trash2,
  RotateCcw,
  Search,
  ArrowRightLeft,
  X
} from 'lucide-react';
import {
  db,
  seedDefaultBags,
  resetBagsToDefault,
  toggleBagItemPacked,
  addBagItem,
  updateBagItem,
  deleteBagItem,
  type BagItem
} from '../db';
import { p2pSyncManager } from '../utils/p2pSync';

export function HospitalBagsView() {
  // Ensure default bags are seeded
  useEffect(() => {
    seedDefaultBags();
  }, []);

  const rawBags = useLiveQuery(() => db.hospitalBags.orderBy('order').toArray(), []);
  const allItems = useLiveQuery(() => db.bagItems.orderBy('order').toArray(), []);

  // Guarantee unique bags by code (L, M, S)
  const bags = useMemo(() => {
    if (!rawBags) return [];
    const seen = new Set<string>();
    return rawBags.filter(b => {
      if (seen.has(b.code)) return false;
      seen.add(b.code);
      return true;
    });
  }, [rawBags]);

  const [selectedBagId, setSelectedBagId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unpacked' | 'packed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('шт');
  const [newItemNotes, setNewItemNotes] = useState('');
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [movingItem, setMovingItem] = useState<BagItem | null>(null);

  const handleMoveItem = async (targetBagId: number) => {
    if (!movingItem?.id) return;
    await updateBagItem(movingItem.id, { bagId: targetBagId });
    const updated = await db.bagItems.get(movingItem.id);
    if (updated) p2pSyncManager.broadcastBagItem(updated);
    setMovingItem(null);
  };

  // Set default active bag once loaded
  useEffect(() => {
    if (bags && bags.length > 0 && selectedBagId === null) {
      setSelectedBagId(bags[0].id || null);
    }
  }, [bags, selectedBagId]);

  // Overall checklist completion stats
  const overallStats = useMemo(() => {
    if (!allItems || allItems.length === 0) return { total: 0, packed: 0, percentage: 0 };
    const total = allItems.length;
    const packed = allItems.filter(i => i.isPacked).length;
    const percentage = Math.round((packed / total) * 100);
    return { total, packed, percentage };
  }, [allItems]);

  // Active bag stats
  const currentBag = useMemo(() => {
    return bags?.find(b => b.id === selectedBagId);
  }, [bags, selectedBagId]);

  const currentBagItems = useMemo(() => {
    if (!allItems || selectedBagId === null) return [];
    return allItems.filter(i => i.bagId === selectedBagId);
  }, [allItems, selectedBagId]);

  // Filtered items list (with search & state filter)
  const displayItems = useMemo(() => {
    let list = searchQuery ? (allItems || []) : currentBagItems;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.notes && i.notes.toLowerCase().includes(q))
      );
    }

    if (filterMode === 'unpacked') {
      list = list.filter(i => !i.isPacked);
    } else if (filterMode === 'packed') {
      list = list.filter(i => i.isPacked);
    }

    return list;
  }, [searchQuery, allItems, currentBagItems, filterMode]);

  // Toggle item packed with haptic feedback
  const handleToggle = async (itemId: number) => {
    if ('vibrate' in navigator) navigator.vibrate([25]);
    await toggleBagItemPacked(itemId);
    const updated = await db.bagItems.get(itemId);
    if (updated) p2pSyncManager.broadcastBagItem(updated);
  };

  // Change quantity (+1 / -1)
  const handleUpdateQuantity = async (e: React.MouseEvent, item: BagItem, delta: number) => {
    e.stopPropagation();
    if (!item.id) return;
    const nextQty = Math.max(1, (item.quantity || 1) + delta);
    if ('vibrate' in navigator) navigator.vibrate([15]);
    await updateBagItem(item.id, { quantity: nextQty });
    const updated = await db.bagItems.get(item.id);
    if (updated) p2pSyncManager.broadcastBagItem(updated);
  };

  // Add custom item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || selectedBagId === null) return;

    const maxOrder = currentBagItems.reduce((max, i) => Math.max(max, i.order), 0);
    const id = await addBagItem({
      bagId: selectedBagId,
      name: newItemName.trim(),
      quantity: parseInt(newItemQuantity, 10) || 1,
      unit: newItemUnit.trim() || undefined,
      isPacked: false,
      notes: newItemNotes.trim() || undefined,
      order: maxOrder + 1
    });

    const newItem = await db.bagItems.get(id);
    if (newItem) p2pSyncManager.broadcastBagItem(newItem);

    setNewItemName('');
    setNewItemQuantity('1');
    setNewItemNotes('');
    setShowAddModal(false);
  };

  const getBagIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sparkles':
        return <Sparkles className="w-4 h-4" />;
      case 'Heart':
        return <Heart className="w-4 h-4" />;
      case 'Baby':
        return <Baby className="w-4 h-4" />;
      default:
        return <Sparkles className="w-4 h-4" />;
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 space-y-4">
      {/* OVERALL PROGRESS CARD */}
      <div className="bg-gradient-to-tr from-rose-500 via-pink-500 to-rose-600 rounded-3xl p-5 text-white shadow-md shadow-rose-500/20">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-rose-100 uppercase tracking-wider block">
              Сумки в пологовий
            </span>
            <h2 className="text-2xl font-black tracking-tight mt-0.5">
              {overallStats.percentage}% зібрано
            </h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-rose-100 font-medium block">
              {overallStats.packed} з {overallStats.total} речей
            </span>
            <span className="text-[10px] text-rose-200">
              Залишилось: {overallStats.total - overallStats.packed}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-white/25 rounded-full h-2.5 mt-4 overflow-hidden">
          <div
            className="bg-white h-2.5 rounded-full transition-all duration-300 shadow-sm"
            style={{ width: `${overallStats.percentage}%` }}
          />
        </div>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Пошук речей по всіх сумках..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl text-xs font-medium placeholder-gray-400 focus:outline-none focus:border-rose-400"
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

        {/* BAG TABS (L / M / S) - Hidden if searching across all */}
        {!searchQuery && (
          <div className="grid grid-cols-3 gap-2">
            {bags?.map((bag) => {
              const isSelected = bag.id === selectedBagId;
              const bagItems = allItems?.filter(i => i.bagId === bag.id) || [];
              const packedCount = bagItems.filter(i => i.isPacked).length;
              const totalCount = bagItems.length;

              return (
                <button
                  key={bag.id}
                  type="button"
                  onClick={() => setSelectedBagId(bag.id || null)}
                  className={`p-2.5 rounded-2xl flex flex-col items-center justify-center text-center transition-all duration-150 active:scale-95 border ${
                    isSelected
                      ? 'bg-white dark:bg-zinc-900 border-rose-500 shadow-sm text-gray-900 dark:text-white'
                      : 'bg-gray-100/80 dark:bg-zinc-800/80 border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <div className="flex items-center space-x-1">
                    <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-md ${
                      isSelected ? 'bg-rose-500 text-white' : 'bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      {bag.size}
                    </span>
                    <span className={isSelected ? 'text-rose-500' : 'text-gray-400'}>
                      {getBagIcon(bag.icon)}
                    </span>
                  </div>
                  <span className="text-[11px] font-bold mt-1 line-clamp-1">
                    {bag.code === 'labor' ? 'В родзал' : bag.code === 'mom' ? 'Для мами' : 'Для малюка'}
                  </span>
                  <span className="text-[10px] text-gray-400 mt-0.5">
                    {packedCount}/{totalCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* FILTER BUTTONS & CONTROLS */}
      <div className="flex items-center justify-between pt-1 px-1">
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
              filterMode === 'all'
                ? 'bg-gray-900 text-white dark:bg-white dark:text-black'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            Всі ({currentBagItems.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('unpacked')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
              filterMode === 'unpacked'
                ? 'bg-rose-500 text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            Залишилось ({currentBagItems.filter(i => !i.isPacked).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterMode('packed')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition ${
              filterMode === 'packed'
                ? 'bg-emerald-600 text-white'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            Зібрано ({currentBagItems.filter(i => i.isPacked).length})
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="px-2.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-sm shadow-rose-500/20 active:scale-95 transition flex items-center space-x-1"
            title="Додати річ"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Додати річ</span>
          </button>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            className="p-1.5 rounded-xl text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
            title="Скинути до стандартного шаблону"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ITEMS LIST */}
      <div className="space-y-2">
        {displayItems.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-400 text-sm">
            {searchQuery
              ? 'Нічого не знайдено за вашим запитом.'
              : filterMode === 'unpacked'
              ? '🎉 Усі речі в цій сумці вже зібрано!'
              : 'Список порожній. Додайте перший пункт!'}
          </div>
        ) : (
          displayItems.map((item) => {
            const bag = bags?.find(b => b.id === item.bagId);
            return (
              <div
                key={item.id}
                onClick={() => item.id && handleToggle(item.id)}
                className={`p-3.5 rounded-2xl border transition-all duration-150 flex items-start justify-between cursor-pointer select-none ${
                  item.isPacked
                    ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-500/30 text-gray-500 dark:text-gray-400'
                    : 'bg-white dark:bg-zinc-900 border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-gray-100 shadow-xs'
                }`}
              >
                <div className="flex items-start space-x-3 flex-1">
                  <div className="pt-0.5">
                    {item.isPacked ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-500 fill-emerald-50 dark:fill-emerald-950" />
                    ) : (
                      <Circle className="w-5 h-5 text-gray-300 hover:text-rose-400 transition" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-2">
                      <span className={`text-sm font-semibold leading-tight ${item.isPacked ? 'line-through opacity-70' : ''}`}>
                        {item.name}
                      </span>
                    </div>

                    {/* Quantity Stepper & Notes */}
                    <div className="mt-1.5 flex items-center space-x-2">
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-zinc-800 border border-gray-200/60 dark:border-zinc-700/60 px-1 py-0.5"
                      >
                        <button
                          type="button"
                          disabled={item.quantity <= 1}
                          onClick={(e) => handleUpdateQuantity(e, item, -1)}
                          className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white disabled:opacity-30 active:scale-90 transition"
                          title="Зменшити кількість"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="text-[11px] font-extrabold px-1.5 min-w-[20px] text-center text-gray-700 dark:text-gray-200">
                          {item.quantity} {item.unit || 'шт'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => handleUpdateQuantity(e, item, 1)}
                          className="w-5 h-5 flex items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white active:scale-90 transition"
                          title="Збільшити кількість"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {item.notes && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 line-clamp-1">
                          {item.notes}
                        </p>
                      )}
                    </div>
                    {searchQuery && bag && (
                      <span className="inline-block text-[10px] font-bold text-rose-500 mt-1">
                        {bag.name}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-0.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMovingItem(item);
                    }}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 transition opacity-70 hover:opacity-100 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
                    title="Перемістити в іншу сумку"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.id) {
                        p2pSyncManager.broadcastDeletedBagItem(item.name);
                        deleteBagItem(item.id);
                      }
                    }}
                    className="p-1.5 text-gray-300 hover:text-rose-500 transition opacity-60 hover:opacity-100 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
                    title="Видалити"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ADD ITEM MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Додати в {currentBag?.name || 'сумку'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Назва речі:
                </label>
                <input
                  type="text"
                  placeholder="наприклад: Зарядний пристрій"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  required
                />
              </div>

              {/* Target Bag Selector inside modal */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Сумка призначення:</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {bags.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBagId(b.id || null)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition ${
                        selectedBagId === b.id
                          ? 'border-rose-500 bg-rose-500 text-white shadow-xs'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {b.size} — {b.code === 'labor' ? 'Родзал' : b.code === 'mom' ? 'Мама' : 'Малюк'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Кількість:</label>
                  <div className="flex items-center rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 overflow-hidden">
                    <button
                      type="button"
                      disabled={parseInt(newItemQuantity, 10) <= 1}
                      onClick={() => setNewItemQuantity(prev => Math.max(1, (parseInt(prev, 10) || 1) - 1).toString())}
                      className="px-2.5 py-2 text-gray-500 hover:text-black dark:hover:text-white disabled:opacity-30"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={newItemQuantity}
                      onChange={(e) => setNewItemQuantity(e.target.value)}
                      className="w-full text-center bg-transparent border-none text-sm font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setNewItemQuantity(prev => ((parseInt(prev, 10) || 1) + 1).toString())}
                      className="px-2.5 py-2 text-gray-500 hover:text-black dark:hover:text-white"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Одиниці:</label>
                  <input
                    type="text"
                    placeholder="шт, уп, компл"
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Підказка / Примітка (необов'язково):
                </label>
                <input
                  type="text"
                  placeholder="покласти зверху, взяти з дому тощо"
                  value={newItemNotes}
                  onChange={(e) => setNewItemNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
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
                  Додати
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* RESET TO DEFAULT CONFIRMATION MODAL */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 text-center">
            <RotateCcw className="w-10 h-10 text-rose-500 mx-auto" />
            <div>
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Скинути список до стандарту?
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Це відновить базовий набір сумок (M, L, S) та скине статус зібраних речей.
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
              >
                Ні, залишити
              </button>
              <button
                type="button"
                onClick={async () => {
                  await resetBagsToDefault();
                  setShowResetConfirm(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
              >
                Так, скинути
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOVE ITEM TO ANOTHER BAG MODAL */}
      {movingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white">
                  Перемістити річ
                </h3>
                <p className="text-xs text-rose-500 font-semibold mt-0.5 line-clamp-1">
                  «{movingItem.name}»
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMovingItem(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Оберіть сумку, в яку слід перемістити цю річ:
            </p>

            <div className="space-y-2">
              {bags.map((b) => {
                const isCurrent = b.id === movingItem.bagId;
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={isCurrent}
                    onClick={() => b.id && handleMoveItem(b.id)}
                    className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition ${
                      isCurrent
                        ? 'bg-gray-100/60 dark:bg-zinc-800/40 border-transparent opacity-50 cursor-not-allowed'
                        : 'bg-white dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 hover:border-rose-400 active:scale-98 shadow-xs'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="w-7 h-7 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 font-extrabold text-xs flex items-center justify-center">
                        {b.size}
                      </span>
                      <div>
                        <div className="text-xs font-bold text-gray-900 dark:text-white">
                          {b.name}
                        </div>
                        {isCurrent && (
                          <div className="text-[10px] text-gray-400 font-medium">
                            (поточна сумка)
                          </div>
                        )}
                      </div>
                    </div>
                    {!isCurrent && (
                      <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setMovingItem(null)}
              className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs mt-1"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
