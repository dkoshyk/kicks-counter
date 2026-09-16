import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Sparkles,
  Heart,
  Baby,
  Package,
  Briefcase,
  ShoppingBag,
  Pill,
  Shirt,
  Shield,
  CheckCircle2,
  Circle,
  Plus,
  Minus,
  Trash2,
  RotateCcw,
  Search,
  ArrowRightLeft,
  X,
  Pencil,
  History,
  Undo2,
  Check,
  Clock,
  Send
} from 'lucide-react';
import {
  db,
  seedDefaultBags,
  resetBagsToDefault,
  toggleBagItemPacked,
  addBagItem,
  updateBagItem,
  deleteBagItem,
  addHospitalBag,
  updateHospitalBag,
  deleteHospitalBag,
  restoreHospitalBag,
  revertToBagHistory,
  addBagDraftProposal,
  resolveBagDraftProposal,
  deleteBagDraftProposal,
  type HospitalBag,
  type BagItem,
  type BagDraftProposal,
  type BagChangeHistory
} from '../db';
import { p2pSyncManager } from '../utils/p2pSync';

// Available icons for custom and edited bags
const AVAILABLE_ICONS = [
  { name: 'Sparkles', label: 'Пологи', icon: Sparkles },
  { name: 'Heart', label: 'Мама', icon: Heart },
  { name: 'Baby', label: 'Малюк', icon: Baby },
  { name: 'Package', label: 'Пакунок', icon: Package },
  { name: 'Briefcase', label: 'Документи', icon: Briefcase },
  { name: 'ShoppingBag', label: 'Речі', icon: ShoppingBag },
  { name: 'Pill', label: 'Аптечка', icon: Pill },
  { name: 'Shirt', label: 'Виписка', icon: Shirt },
  { name: 'Shield', label: 'Гігієна', icon: Shield }
];

// Available color themes for bags
const COLOR_PRESETS = [
  { label: 'Рожевий', value: 'from-rose-500 to-pink-500' },
  { label: 'Бурштиновий', value: 'from-amber-500 to-rose-500' },
  { label: 'Блакитний', value: 'from-sky-500 to-indigo-500' },
  { label: 'Смарагдовий', value: 'from-emerald-500 to-teal-500' },
  { label: 'Фіолетовий', value: 'from-purple-500 to-pink-500' },
  { label: 'Індиго', value: 'from-indigo-600 to-blue-500' }
];

export function HospitalBagsView() {
  // Ensure default bags exist on startup
  useEffect(() => {
    seedDefaultBags();
  }, []);

  // P2P Role tracking
  const [p2pRole, setP2pRole] = useState<'master' | 'slave' | 'none'>(p2pSyncManager.getRole());
  useEffect(() => {
    p2pSyncManager.setOnStatusChange((_status, _count) => {
      setP2pRole(p2pSyncManager.getRole());
    });
  }, []);

  const isMom = p2pRole === 'master';
  const isDad = p2pRole === 'slave';

  // Live queries
  const rawBags = useLiveQuery(() => db.hospitalBags.orderBy('order').toArray(), []);
  const allItems = useLiveQuery(() => db.bagItems.orderBy('order').toArray(), []);
  const pendingProposals = useLiveQuery(
    () => db.bagDraftProposals.where('status').equals('pending').reverse().toArray(),
    []
  );
  const changeHistory = useLiveQuery(
    () => db.bagChangeHistory.orderBy('timestamp').reverse().limit(35).toArray(),
    []
  );

  const bags = useMemo(() => rawBags || [], [rawBags]);

  // Active bag selection
  const [selectedBagId, setSelectedBagId] = useState<number | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'unpacked' | 'packed'>('all');

  // Modals state
  const [showAddBagModal, setShowAddBagModal] = useState(false);
  const [showEditBagModal, setShowEditBagModal] = useState(false);
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showMoveItemModal, setShowMoveItemModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showProposalsModal, setShowProposalsModal] = useState(false);
  const [showDadDraftsModal, setShowDadDraftsModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showDeleteBagConfirm, setShowDeleteBagConfirm] = useState(false);

  // Edit / Add bag form state
  const [bagFormName, setBagFormName] = useState('');
  const [bagFormSize, setBagFormSize] = useState('M');
  const [bagFormIcon, setBagFormIcon] = useState('Sparkles');
  const [bagFormColor, setBagFormColor] = useState('from-rose-500 to-pink-500');

  // Add Item form state
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('1');
  const [newItemUnit, setNewItemUnit] = useState('шт');
  const [newItemNotes, setNewItemNotes] = useState('');
  const [movingItem, setMovingItem] = useState<BagItem | null>(null);

  // Edit Item form state
  const [showEditItemModal, setShowEditItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<BagItem | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemQuantity, setEditItemQuantity] = useState('1');
  const [editItemUnit, setEditItemUnit] = useState('шт');
  const [editItemNotes, setEditItemNotes] = useState('');
  const [editItemBagId, setEditItemBagId] = useState<number>(0);

  // Temporary local notification toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToastMessage(null), 3500);
  };

  // Undo deletion state (10s countdown)
  const [undoBagData, setUndoBagData] = useState<{
    bag: HospitalBag;
    items: BagItem[];
    expiresAt: number;
  } | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number>(0);

  useEffect(() => {
    if (!undoBagData) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((undoBagData.expiresAt - Date.now()) / 1000));
      setUndoSecondsLeft(remaining);
      if (remaining <= 0) {
        setUndoBagData(null);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [undoBagData]);

  // Default active bag selection
  useEffect(() => {
    if (bags.length > 0 && (selectedBagId === null || !bags.some(b => b.id === selectedBagId))) {
      setSelectedBagId(bags[0].id || null);
    }
  }, [bags, selectedBagId]);

  // Active bag & items
  const currentBag = useMemo(() => {
    return bags.find(b => b.id === selectedBagId) || bags[0];
  }, [bags, selectedBagId]);

  const currentBagItems = useMemo(() => {
    if (!allItems || !currentBag?.id) return [];
    return allItems.filter(i => i.bagId === currentBag.id);
  }, [allItems, currentBag]);

  // Overall stats
  const overallStats = useMemo(() => {
    if (!allItems || allItems.length === 0) return { total: 0, packed: 0, percentage: 0 };
    const total = allItems.length;
    const packed = allItems.filter(i => i.isPacked).length;
    const percentage = Math.round((packed / total) * 100);
    return { total, packed, percentage };
  }, [allItems]);

  // Filtered items list
  const displayItems = useMemo(() => {
    let list = searchQuery.trim() ? (allItems || []) : currentBagItems;

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

  // Helper to render icon component
  const getBagIcon = (iconName: string) => {
    switch (iconName) {
      case 'Sparkles':
        return <Sparkles className="w-4 h-4" />;
      case 'Heart':
        return <Heart className="w-4 h-4" />;
      case 'Baby':
        return <Baby className="w-4 h-4" />;
      case 'Package':
        return <Package className="w-4 h-4" />;
      case 'Briefcase':
        return <Briefcase className="w-4 h-4" />;
      case 'ShoppingBag':
        return <ShoppingBag className="w-4 h-4" />;
      case 'Pill':
        return <Pill className="w-4 h-4" />;
      case 'Shirt':
        return <Shirt className="w-4 h-4" />;
      case 'Shield':
        return <Shield className="w-4 h-4" />;
      default:
        return <Sparkles className="w-4 h-4" />;
    }
  };

  // -------------------------------------------------------------
  // HANDLERS: ITEM ACTIONS (MOM DIRECT / DAD PROPOSAL)
  // -------------------------------------------------------------

  const handleToggleItem = async (item: BagItem) => {
    if ('vibrate' in navigator) navigator.vibrate([25]);

    if (isDad) {
      const nextStatus = !item.isPacked;
      const desc = `Позначити «${item.name}» як ${nextStatus ? 'зібрано' : 'не зібрано'}`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'toggle_packed',
        description: desc,
        targetId: item.id,
        bagId: item.bagId,
        itemName: item.name,
        data: { ...item, isPacked: nextStatus }
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      showToast(`Пропозицію надіслано мамі ⏳: ${desc}`);
      return;
    }

    // Mom or standalone
    if (item.id) {
      await toggleBagItemPacked(item.id, 'mom');
      const updated = await db.bagItems.get(item.id);
      if (updated) p2pSyncManager.broadcastBagItem(updated);
    }
  };

  const handleUpdateQuantity = async (e: React.MouseEvent, item: BagItem, delta: number) => {
    e.stopPropagation();
    if (!item.id) return;
    const nextQty = Math.max(1, (item.quantity || 1) + delta);
    if ('vibrate' in navigator) navigator.vibrate([15]);

    if (isDad) {
      const desc = `Змінити кількість «${item.name}» на ${nextQty}`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'edit_item',
        description: desc,
        targetId: item.id,
        bagId: item.bagId,
        itemName: item.name,
        data: { quantity: nextQty }
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      showToast('Зміну кількості запропоновано мамі ⏳');
      return;
    }

    // Mom or standalone
    await updateBagItem(item.id, { quantity: nextQty }, 'mom');
    const updated = await db.bagItems.get(item.id);
    if (updated) p2pSyncManager.broadcastBagItem(updated);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || selectedBagId === null) return;

    const maxOrder = currentBagItems.reduce((max, i) => Math.max(max, i.order), 0);

    if (isDad) {
      const desc = `Додати «${newItemName.trim()}» у ${currentBag?.name || 'сумку'}`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'add_item',
        description: desc,
        bagId: selectedBagId,
        bagName: currentBag?.name,
        itemName: newItemName.trim(),
        data: {
          bagId: selectedBagId,
          name: newItemName.trim(),
          quantity: parseInt(newItemQuantity, 10) || 1,
          unit: newItemUnit.trim() || undefined,
          isPacked: false,
          notes: newItemNotes.trim() || undefined,
          order: maxOrder + 1
        }
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);

      setNewItemName('');
      setNewItemQuantity('1');
      setNewItemNotes('');
      setShowAddItemModal(false);
      showToast('Додавання речі надіслано мамі як чернетку ⏳');
      return;
    }

    // Mom or standalone
    const id = await addBagItem({
      bagId: selectedBagId,
      name: newItemName.trim(),
      quantity: parseInt(newItemQuantity, 10) || 1,
      unit: newItemUnit.trim() || undefined,
      isPacked: false,
      notes: newItemNotes.trim() || undefined,
      order: maxOrder + 1
    }, 'mom');

    const newItem = await db.bagItems.get(id);
    if (newItem) p2pSyncManager.broadcastBagItem(newItem);

    setNewItemName('');
    setNewItemQuantity('1');
    setNewItemNotes('');
    setShowAddItemModal(false);
    showToast(`Річ «${newItem?.name}» додано`);
  };

  const handleDeleteItem = async (e: React.MouseEvent, item: BagItem) => {
    e.stopPropagation();
    if (!item.id) return;

    if (isDad) {
      const desc = `Видалити «${item.name}»`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'delete_item',
        description: desc,
        targetId: item.id,
        bagId: item.bagId,
        itemName: item.name
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      showToast('Запит на видалення надіслано мамі ⏳');
      return;
    }

    // Mom or standalone
    await deleteBagItem(item.id, 'mom');
    p2pSyncManager.broadcastDeletedBagItem(item.name);
    showToast(`Річ «${item.name}» видалено`);
  };

  const handleMoveItem = async (targetBagId: number) => {
    if (!movingItem?.id) return;

    if (isDad) {
      const targetBag = bags.find(b => b.id === targetBagId);
      const desc = `Перемістити «${movingItem.name}» у «${targetBag?.name || 'іншу сумку'}»`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'edit_item',
        description: desc,
        targetId: movingItem.id,
        bagId: targetBagId,
        itemName: movingItem.name,
        data: { bagId: targetBagId }
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      setMovingItem(null);
      showToast('Переміщення надіслано мамі на розгляд ⏳');
      return;
    }

    // Mom or standalone
    await updateBagItem(movingItem.id, { bagId: targetBagId }, 'mom');
    const updated = await db.bagItems.get(movingItem.id);
    if (updated) p2pSyncManager.broadcastBagItem(updated);
    setMovingItem(null);
    showToast(`Річ «${movingItem.name}» переміщено`);
  };

  const openEditItemModal = (item: BagItem) => {
    setEditingItem(item);
    setEditItemName(item.name);
    setEditItemQuantity(item.quantity?.toString() || '1');
    setEditItemUnit(item.unit || 'шт');
    setEditItemNotes(item.notes || '');
    setEditItemBagId(item.bagId);
    setShowEditItemModal(true);
  };

  const handleSaveEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem?.id || !editItemName.trim()) return;

    const changes = {
      name: editItemName.trim(),
      quantity: parseInt(editItemQuantity, 10) || 1,
      unit: editItemUnit.trim() || undefined,
      notes: editItemNotes.trim() || undefined,
      bagId: editItemBagId || editingItem.bagId
    };

    if (isDad) {
      const desc = editingItem.name !== editItemName.trim()
        ? `Перейменувати «${editingItem.name}» на «${editItemName.trim()}»`
        : `Оновити річ «${editingItem.name}»`;

      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'edit_item',
        description: desc,
        targetId: editingItem.id,
        bagId: changes.bagId,
        itemName: editItemName.trim(),
        data: changes
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);

      setShowEditItemModal(false);
      showToast('Редагування речі запропоновано мамі ⏳');
      return;
    }

    // Mom or standalone
    await updateBagItem(editingItem.id, changes, 'mom');
    const updated = await db.bagItems.get(editingItem.id);
    if (updated) p2pSyncManager.broadcastBagItem(updated);

    setShowEditItemModal(false);
    showToast(`Річ «${changes.name}» оновлено`);
  };

  // -------------------------------------------------------------
  // HANDLERS: BAG MANAGEMENT (ADD, EDIT, DELETE & UNDO)
  // -------------------------------------------------------------

  const openAddBagModal = () => {
    setBagFormName('');
    setBagFormSize('M');
    setBagFormIcon('Package');
    setBagFormColor('from-rose-500 to-pink-500');
    setShowAddBagModal(true);
  };

  const openEditBagModal = () => {
    if (!currentBag) return;
    setBagFormName(currentBag.name);
    setBagFormSize(currentBag.size);
    setBagFormIcon(currentBag.icon);
    setBagFormColor(currentBag.color);
    setShowEditBagModal(true);
  };

  const handleSaveNewBag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bagFormName.trim()) return;

    const maxOrder = bags.reduce((max, b) => Math.max(max, b.order), 0);
    const newBagData: Omit<HospitalBag, 'id'> = {
      name: bagFormName.trim(),
      code: `bag-${Date.now()}`,
      size: bagFormSize.trim() || 'M',
      icon: bagFormIcon,
      color: bagFormColor,
      order: maxOrder + 1
    };

    if (isDad) {
      const desc = `Додати нову сумку «${bagFormName.trim()}»`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'add_bag',
        description: desc,
        bagName: bagFormName.trim(),
        data: newBagData
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      setShowAddBagModal(false);
      showToast('Створення нової сумки запропоновано мамі ⏳');
      return;
    }

    // Mom or standalone
    const newId = await addHospitalBag(newBagData, 'mom');
    const createdBag = await db.hospitalBags.get(newId);
    if (createdBag) p2pSyncManager.broadcastHospitalBag(createdBag);

    setSelectedBagId(newId);
    setShowAddBagModal(false);
    showToast(`Сумку «${bagFormName.trim()}» створено! 🎉`);
  };

  const handleSaveEditBag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBag?.id || !bagFormName.trim()) return;

    const changes: Partial<HospitalBag> = {
      name: bagFormName.trim(),
      size: bagFormSize.trim() || 'M',
      icon: bagFormIcon,
      color: bagFormColor
    };

    if (isDad) {
      const desc = `Оновити сумку «${currentBag.name}»`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'edit_bag',
        description: desc,
        targetId: currentBag.id,
        bagName: currentBag.name,
        data: changes
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      setShowEditBagModal(false);
      showToast('Редагування сумки запропоновано мамі ⏳');
      return;
    }

    // Mom or standalone
    await updateHospitalBag(currentBag.id, changes, 'mom');
    const updated = await db.hospitalBags.get(currentBag.id);
    if (updated) p2pSyncManager.broadcastHospitalBag(updated);

    setShowEditBagModal(false);
    showToast(`Сумку «${updated?.name}» оновлено`);
  };

  const handleDeleteBag = async () => {
    if (!currentBag?.id) return;
    setShowDeleteBagConfirm(false);
    setShowEditBagModal(false);

    if (isDad) {
      const desc = `Видалити сумку «${currentBag.name}»`;
      const propId = await addBagDraftProposal({
        author: 'dad',
        action: 'delete_bag',
        description: desc,
        targetId: currentBag.id,
        bagName: currentBag.name
      });
      const prop = await db.bagDraftProposals.get(propId);
      if (prop) p2pSyncManager.broadcastBagDraftProposal(prop);
      showToast('Видалення сумки запропоновано мамі ⏳');
      return;
    }

    // Mom or standalone: Delete with instant Undo snapshot
    const deletedInfo = await deleteHospitalBag(currentBag.id, 'mom');
    if (deletedInfo) {
      p2pSyncManager.broadcastDeletedHospitalBag(currentBag.id, currentBag.name);
      setUndoBagData({
        bag: deletedInfo.bag,
        items: deletedInfo.items,
        expiresAt: Date.now() + 10000
      });
      setUndoSecondsLeft(10);
      showToast(`Сумку «${currentBag.name}» видалено`);
    }
  };

  const handleUndoDeleteBag = async () => {
    if (!undoBagData) return;
    const restoredBagId = await restoreHospitalBag(undoBagData.bag, undoBagData.items, 'mom');
    const restoredBag = await db.hospitalBags.get(restoredBagId);
    if (restoredBag) {
      p2pSyncManager.broadcastHospitalBag(restoredBag);
      setSelectedBagId(restoredBagId);
    }
    const [allB, allI] = await Promise.all([db.hospitalBags.toArray(), db.bagItems.toArray()]);
    p2pSyncManager.broadcastFullBagsSync(allB, allI);

    setUndoBagData(null);
    showToast('Сумку та всі її речі успішно відновлено! 🎉');
  };

  // -------------------------------------------------------------
  // HANDLERS: PROPOSALS APPROVAL & REJECTION (MOM & DAD)
  // -------------------------------------------------------------

  const handleApproveProposal = async (prop: BagDraftProposal) => {
    if (!prop.id) return;
    const { applied } = await resolveBagDraftProposal(prop.id, 'approved');
    if (applied) {
      p2pSyncManager.broadcastProposalResolved(prop.id, 'approved', prop.description);
      const [allB, allI] = await Promise.all([db.hospitalBags.toArray(), db.bagItems.toArray()]);
      p2pSyncManager.broadcastFullBagsSync(allB, allI);
      showToast(`Затверджено: «${prop.description}» ✅`);
    }
  };

  const handleRejectProposal = async (prop: BagDraftProposal) => {
    if (!prop.id) return;
    await resolveBagDraftProposal(prop.id, 'rejected');
    p2pSyncManager.broadcastProposalResolved(prop.id, 'rejected', prop.description);
    showToast(`Відхилено: «${prop.description}» ❌`);
  };

  const handleApproveAllProposals = async () => {
    if (!pendingProposals || pendingProposals.length === 0) return;
    for (const p of pendingProposals) {
      if (p.id) {
        await resolveBagDraftProposal(p.id, 'approved');
        p2pSyncManager.broadcastProposalResolved(p.id, 'approved', p.description);
      }
    }
    const [allB, allI] = await Promise.all([db.hospitalBags.toArray(), db.bagItems.toArray()]);
    p2pSyncManager.broadcastFullBagsSync(allB, allI);
    setShowProposalsModal(false);
    showToast('Усі зміни від тата затверджено! ✅');
  };

  const handleRejectAllProposals = async () => {
    if (!pendingProposals || pendingProposals.length === 0) return;
    for (const p of pendingProposals) {
      if (p.id) {
        await resolveBagDraftProposal(p.id, 'rejected');
        p2pSyncManager.broadcastProposalResolved(p.id, 'rejected', p.description);
      }
    }
    setShowProposalsModal(false);
    showToast('Усі пропозиції відхилено ❌');
  };

  const handleDiscardDadProposal = async (propId: number) => {
    await deleteBagDraftProposal(propId);
    showToast('Вашу пропозицію скасовано');
  };

  // -------------------------------------------------------------
  // HANDLERS: CHANGE HISTORY ROLLBACK
  // -------------------------------------------------------------

  const handleRevertToHistory = async (h: BagChangeHistory) => {
    if (!h.id) return;
    const confirmRevert = window.confirm(
      `Повернутися до версії від ${new Date(h.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}? ` +
      `Поточний стан буде збережено в історію перед відновленням.`
    );
    if (!confirmRevert) return;

    await revertToBagHistory(h.id);
    const [allB, allI] = await Promise.all([db.hospitalBags.toArray(), db.bagItems.toArray()]);
    if (isMom) {
      p2pSyncManager.broadcastFullBagsSync(allB, allI);
    }
    setShowHistoryModal(false);
    showToast('Сумки та речі повернуто до обраної версії 🔄');
  };

  return (
    <div className="max-w-md mx-auto px-4 space-y-4 pb-12">
      {/* FLOATING LOCAL TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[92%] animate-in fade-in slide-in-from-top-3 duration-200 pointer-events-none">
          <div className="bg-gray-900/95 dark:bg-zinc-800/95 text-white px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md border border-white/10 flex items-center justify-between text-xs font-semibold">
            <span className="truncate pr-2">{toastMessage}</span>
            <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider shrink-0">
              Поштовхи
            </span>
          </div>
        </div>
      )}

      {/* OVERALL PROGRESS CARD */}
      <div className={`bg-gradient-to-tr ${currentBag?.color || 'from-rose-500 via-pink-500 to-rose-600'} rounded-3xl p-5 text-white shadow-md shadow-rose-500/20 transition-all duration-300`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-semibold text-rose-100 uppercase tracking-wider block">
                Сумки в пологовий
              </span>
              {isDad && (
                <span className="text-[9px] font-bold bg-white/25 px-1.5 py-0.5 rounded-full">
                  Тато 🧔
                </span>
              )}
              {isMom && (
                <span className="text-[9px] font-bold bg-white/25 px-1.5 py-0.5 rounded-full">
                  Мама-Майстер 🌸
                </span>
              )}
            </div>
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

      {/* PARTNER DRAFT PROPOSALS BANNER (FOR MOM) */}
      {isMom && pendingProposals && pendingProposals.length > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-2xl flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Send className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-900 dark:text-amber-100">
                Нові пропозиції від тата ({pendingProposals.length})
              </p>
              <p className="text-[10px] text-amber-700 dark:text-amber-300">
                Перегляньте зміни перед застосуванням
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowProposalsModal(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition"
          >
            Переглянути
          </button>
        </div>
      )}

      {/* PARTNER DRAFTS BAR (FOR DAD) */}
      {isDad && (
        <div className="p-3 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/40 rounded-2xl flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-sky-900 dark:text-sky-100">
                Режим пропозицій (Тато)
              </p>
              <p className="text-[10px] text-sky-700 dark:text-sky-300">
                Ваші зміни зберігаються як чернетки для мами
              </p>
            </div>
          </div>
          {pendingProposals && pendingProposals.length > 0 && (
            <button
              type="button"
              onClick={() => setShowDadDraftsModal(true)}
              className="px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition"
            >
              Чернетки ({pendingProposals.length})
            </button>
          )}
        </div>
      )}

      {/* SEARCH BAR & TOOLBAR */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Пошук по всіх сумках..."
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

          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="p-2.5 rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 text-gray-600 dark:text-gray-300 hover:text-rose-500 transition active:scale-95 shadow-xs shrink-0"
            title="Історія змін та відкат"
          >
            <History className="w-4 h-4" />
          </button>
        </div>

        {/* BAGS SECTION HEADER (SINGLE EXPLICIT ADD BAG BUTTON) */}
        {!searchQuery && (
          <div className="flex items-center justify-between px-1 pt-1 pb-1">
            <span className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              Ваші сумки ({bags.length})
            </span>
            <button
              type="button"
              onClick={openAddBagModal}
              className="px-3 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs flex items-center space-x-1 shadow-xs shadow-rose-500/20 active:scale-95 transition"
              title="Створити нову сумку"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>+ Нова сумка</span>
            </button>
          </div>
        )}

        {/* SCROLLABLE BAG TABS */}
        {!searchQuery && (
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 pt-0.5">
            {bags.map((bag) => {
              const isSelected = bag.id === selectedBagId;
              const bagItems = allItems?.filter(i => i.bagId === bag.id) || [];
              const packedCount = bagItems.filter(i => i.isPacked).length;
              const totalCount = bagItems.length;

              return (
                <button
                  key={bag.id}
                  type="button"
                  onClick={() => setSelectedBagId(bag.id || null)}
                  className={`px-3 py-2.5 rounded-2xl flex flex-col items-center justify-center text-center shrink-0 min-w-[95px] max-w-[130px] transition-all duration-150 active:scale-95 border ${
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
                  <span className="text-[11px] font-bold mt-1 truncate w-full px-0.5">
                    {bag.name}
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

      {/* ACTIVE BAG DETAILS & MANAGEMENT ACTIONS */}
      {currentBag && !searchQuery && (
        <div className="flex items-center justify-between bg-white dark:bg-zinc-900 p-3 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-xs">
          <div className="flex items-center space-x-2.5">
            <div className={`w-8 h-8 rounded-xl bg-gradient-to-tr ${currentBag.color} text-white flex items-center justify-center shadow-xs`}>
              {getBagIcon(currentBag.icon)}
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-gray-900 dark:text-white">
                  {currentBag.name}
                </span>
                <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded-md bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300">
                  {currentBag.size}
                </span>
              </div>
              <span className="text-[10px] text-gray-400">
                {currentBagItems.filter(i => i.isPacked).length} зібрано з {currentBagItems.length}
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={openEditBagModal}
              className="p-1.5 px-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 hover:text-rose-500 transition active:scale-95 flex items-center space-x-1 text-xs font-semibold"
              title="Редагувати параметри сумки"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span className="text-[11px] pr-0.5">Редагувати</span>
            </button>
          </div>
        </div>
      )}

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
            Всі ({searchQuery ? (allItems?.length || 0) : currentBagItems.length})
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
            Залишилось ({searchQuery ? (allItems?.filter(i => !i.isPacked).length || 0) : currentBagItems.filter(i => !i.isPacked).length})
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
            Зібрано ({searchQuery ? (allItems?.filter(i => i.isPacked).length || 0) : currentBagItems.filter(i => i.isPacked).length})
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setShowAddItemModal(true)}
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
              : 'Список порожній. Натисніть «Додати річ»!'}
          </div>
        ) : (
          displayItems.map((item) => {
            const bag = bags.find(b => b.id === item.bagId);
            return (
              <div
                key={item.id}
                onClick={() => handleToggleItem(item)}
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
                      openEditItemModal(item);
                    }}
                    className="p-1.5 text-gray-400 hover:text-rose-500 transition opacity-70 hover:opacity-100 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
                    title="Редагувати або перейменувати річ"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMovingItem(item);
                      setShowMoveItemModal(true);
                    }}
                    className="p-1.5 text-gray-400 hover:text-indigo-500 transition opacity-70 hover:opacity-100 rounded-lg hover:bg-gray-100 dark:hover:bg-zinc-800"
                    title="Перемістити в іншу сумку"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleDeleteItem(e, item)}
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

      {/* UNDO DELETED BAG BANNER (10-SEC COUNTDOWN) */}
      {undoBagData && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[92%] animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="bg-gray-900/95 dark:bg-zinc-800/95 text-white p-3.5 rounded-2xl shadow-2xl backdrop-blur-md border border-white/10 flex items-center justify-between">
            <div className="flex items-center space-x-2.5 truncate pr-2">
              <Trash2 className="w-4 h-4 text-rose-400 shrink-0" />
              <div className="truncate">
                <p className="text-xs font-semibold truncate">
                  Сумку «{undoBagData.bag.name}» видалено ({undoBagData.items.length} речей)
                </p>
                <span className="text-[10px] text-gray-400">
                  Скасувати протягом {undoSecondsLeft} с
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleUndoDeleteBag}
              className="px-3 py-1.5 bg-rose-500 hover:bg-rose-600 active:scale-95 text-white font-bold text-xs rounded-xl shrink-0 transition flex items-center space-x-1 shadow-sm"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Скасувати</span>
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: ADD NEW BAG */}
      {/* --------------------------------------------------------- */}
      {showAddBagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                <Plus className="w-4 h-4 text-rose-500 mr-2" />
                Нова сумка в пологовий
              </h3>
              <button
                type="button"
                onClick={() => setShowAddBagModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveNewBag} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Назва сумки:
                </label>
                <input
                  type="text"
                  placeholder="наприклад: Сумка на виписку"
                  value={bagFormName}
                  onChange={(e) => setBagFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Розмір / Позначка:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {['S', 'M', 'L', 'XL'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setBagFormSize(s)}
                      className={`py-2 rounded-xl text-xs font-bold border transition ${
                        bagFormSize === s
                          ? 'bg-rose-500 border-rose-500 text-white shadow-xs'
                          : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Іконка сумки:
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {AVAILABLE_ICONS.map((it) => {
                    const IconComp = it.icon;
                    const isSelected = bagFormIcon === it.name;
                    return (
                      <button
                        key={it.name}
                        type="button"
                        onClick={() => setBagFormIcon(it.name)}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center transition ${
                          isSelected
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-500'
                            : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-500'
                        }`}
                        title={it.label}
                      >
                        <IconComp className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Колір оформлення:
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLOR_PRESETS.map((col) => (
                    <button
                      key={col.label}
                      type="button"
                      onClick={() => setBagFormColor(col.value)}
                      className={`p-2 rounded-xl text-[11px] font-bold border transition flex items-center space-x-1.5 ${
                        bagFormColor === col.value
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full bg-gradient-to-tr ${col.value} shrink-0`} />
                      <span className="truncate">{col.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowAddBagModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  {isDad ? 'Запропонувати мамі' : 'Створити сумку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: EDIT CURRENT BAG */}
      {/* --------------------------------------------------------- */}
      {showEditBagModal && currentBag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                <Pencil className="w-4 h-4 text-rose-500 mr-2" />
                Редагувати сумку
              </h3>
              <button
                type="button"
                onClick={() => setShowEditBagModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditBag} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Назва сумки:
                </label>
                <input
                  type="text"
                  value={bagFormName}
                  onChange={(e) => setBagFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Розмір / Позначка:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {['S', 'M', 'L', 'XL'].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setBagFormSize(s)}
                      className={`py-2 rounded-xl text-xs font-bold border transition ${
                        bagFormSize === s
                          ? 'bg-rose-500 border-rose-500 text-white shadow-xs'
                          : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Іконка:
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {AVAILABLE_ICONS.map((it) => {
                    const IconComp = it.icon;
                    const isSelected = bagFormIcon === it.name;
                    return (
                      <button
                        key={it.name}
                        type="button"
                        onClick={() => setBagFormIcon(it.name)}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-center transition ${
                          isSelected
                            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-500 text-rose-500'
                            : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-500'
                        }`}
                        title={it.label}
                      >
                        <IconComp className="w-4 h-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Колір оформлення:
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {COLOR_PRESETS.map((col) => (
                    <button
                      key={col.label}
                      type="button"
                      onClick={() => setBagFormColor(col.value)}
                      className={`p-2 rounded-xl text-[11px] font-bold border transition flex items-center space-x-1.5 ${
                        bagFormColor === col.value
                          ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full bg-gradient-to-tr ${col.value} shrink-0`} />
                      <span className="truncate">{col.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  {isDad ? 'Запропонувати мамі' : 'Зберегти зміни'}
                </button>
              </div>

              {/* DANGER ZONE: DELETE BAG */}
              <div className="pt-2 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowDeleteBagConfirm(true)}
                  className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 border border-red-200 dark:border-red-900/40 font-bold text-xs transition flex items-center justify-center space-x-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Видалити цю сумку</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: CONFIRM DELETE BAG */}
      {/* --------------------------------------------------------- */}
      {showDeleteBagConfirm && currentBag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 text-center">
            <Trash2 className="w-10 h-10 text-rose-500 mx-auto" />
            <div>
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Видалити сумку «{currentBag.name}»?
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Це також видалить усі речі ({currentBagItems.length} шт), що належать цій сумці.
                Ви зможете зробити крок назад і відновити її протягом 10 секунд.
              </p>
            </div>
            <div className="flex items-center space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteBagConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
              >
                Скасувати
              </button>
              <button
                type="button"
                onClick={handleDeleteBag}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
              >
                Так, видалити
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: ADD ITEM */}
      {/* --------------------------------------------------------- */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Додати в {currentBag?.name || 'сумку'}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
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

              {/* Dynamic Bag Selector inside modal */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Сумка призначення:</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {bags.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setSelectedBagId(b.id || null)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition truncate ${
                        selectedBagId === b.id
                          ? 'border-rose-500 bg-rose-500 text-white shadow-xs'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {b.size} — {b.name}
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
                  Підказка / Примітка:
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
                  onClick={() => setShowAddItemModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  {isDad ? 'Запропонувати мамі' : 'Додати'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: MOVE ITEM TO ANOTHER BAG */}
      {/* --------------------------------------------------------- */}
      {showMoveItemModal && movingItem && (
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
                onClick={() => setShowMoveItemModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-500 dark:text-gray-400">
              Оберіть сумку, в яку слід перемістити цю річ:
            </p>

            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
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
              onClick={() => setShowMoveItemModal(false)}
              className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs mt-1"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: EDIT ITEM (РЕДАГУВАННЯ / ПЕРЕЙМЕНУВАННЯ РЕЧІ)      */}
      {/* --------------------------------------------------------- */}
      {showEditItemModal && editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                <Pencil className="w-4 h-4 text-rose-500 mr-2" />
                Редагувати річ
              </h3>
              <button
                type="button"
                onClick={() => setShowEditItemModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditItem} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Назва речі:
                </label>
                <input
                  type="text"
                  value={editItemName}
                  onChange={(e) => setEditItemName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              {/* Target Bag Selector inside modal */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Сумка призначення:</label>
                <div className="grid grid-cols-3 gap-1.5 max-h-28 overflow-y-auto pr-1">
                  {bags.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setEditItemBagId(b.id || 0)}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold border transition truncate ${
                        editItemBagId === b.id
                          ? 'border-rose-500 bg-rose-500 text-white shadow-xs'
                          : 'border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {b.size} — {b.name}
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
                      disabled={parseInt(editItemQuantity, 10) <= 1}
                      onClick={() => setEditItemQuantity(prev => Math.max(1, (parseInt(prev, 10) || 1) - 1).toString())}
                      className="px-2.5 py-2 text-gray-500 hover:text-black dark:hover:text-white disabled:opacity-30"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={editItemQuantity}
                      onChange={(e) => setEditItemQuantity(e.target.value)}
                      className="w-full text-center bg-transparent border-none text-sm font-bold focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setEditItemQuantity(prev => ((parseInt(prev, 10) || 1) + 1).toString())}
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
                    value={editItemUnit}
                    onChange={(e) => setEditItemUnit(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">
                  Підказка / Примітка:
                </label>
                <input
                  type="text"
                  placeholder="покласти зверху, взяти з дому тощо"
                  value={editItemNotes}
                  onChange={(e) => setEditItemNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm font-medium"
                />
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowEditItemModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Скасувати
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
                >
                  {isDad ? 'Запропонувати мамі' : 'Зберегти зміни'}
                </button>
              </div>

              <div className="pt-2 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={(e) => {
                    handleDeleteItem(e, editingItem);
                    setShowEditItemModal(false);
                  }}
                  className="w-full py-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 hover:bg-red-100 border border-red-200 dark:border-red-900/40 font-bold text-xs transition flex items-center justify-center space-x-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Видалити цю річ</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: PROPOSALS REVIEW (MOM AS MASTER) */}
      {/* --------------------------------------------------------- */}
      {showProposalsModal && isMom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                  <Send className="w-4 h-4 text-amber-500 mr-1.5" />
                  Зміни від тата ({pendingProposals?.length || 0})
                </h3>
                <p className="text-[10px] text-gray-400">
                  Мама-Майстер: схваліть або відхиліть кожну дію
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProposalsModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Proposals List */}
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {!pendingProposals || pendingProposals.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-xs">
                  Немає активних пропозицій
                </div>
              ) : (
                pendingProposals.map((prop) => (
                  <div
                    key={prop.id}
                    className="p-3 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 flex items-center justify-between"
                  >
                    <div className="flex-1 pr-2">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">
                        {prop.description}
                      </p>
                      <span className="text-[10px] text-gray-400">
                        {new Date(prop.timestamp).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} • Від тата
                      </span>
                    </div>
                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleRejectProposal(prop)}
                        className="p-2 rounded-xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400 active:scale-95 transition"
                        title="Відхилити"
                      >
                        <X className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApproveProposal(prop)}
                        className="p-2 rounded-xl bg-emerald-500 text-white active:scale-95 transition shadow-xs"
                        title="Затвердити"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {pendingProposals && pendingProposals.length > 0 && (
              <div className="flex items-center space-x-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={handleRejectAllProposals}
                  className="flex-1 py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
                >
                  Відхилити всі
                </button>
                <button
                  type="button"
                  onClick={handleApproveAllProposals}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md active:scale-95 transition"
                >
                  Затвердити всі
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: DAD DRAFTS VIEW (FOR DAD TO DISCARD) */}
      {/* --------------------------------------------------------- */}
      {showDadDraftsModal && isDad && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                  <Clock className="w-4 h-4 text-sky-500 mr-1.5" />
                  Ваші чернетки ({pendingProposals?.length || 0})
                </h3>
                <p className="text-[10px] text-gray-400">
                  Очікують схвалення мамою. Ви можете скасувати їх тут.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDadDraftsModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {!pendingProposals || pendingProposals.length === 0 ? (
                <div className="p-4 text-center text-gray-400 text-xs">
                  Немає чернеток в очікуванні
                </div>
              ) : (
                pendingProposals.map((prop) => (
                  <div
                    key={prop.id}
                    className="p-3 rounded-2xl bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200/80 dark:border-sky-900/40 flex items-center justify-between"
                  >
                    <div className="flex-1 pr-2">
                      <p className="text-xs font-bold text-gray-900 dark:text-white">
                        {prop.description}
                      </p>
                      <span className="text-[10px] text-sky-600 dark:text-sky-400 font-semibold">
                        Очікує маму ⏳
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => prop.id && handleDiscardDadProposal(prop.id)}
                      className="px-2.5 py-1.5 rounded-xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400 text-[11px] font-bold active:scale-95 transition"
                    >
                      Скасувати
                    </button>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowDadDraftsModal(false)}
              className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
            >
              Закрити
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: CHANGE HISTORY & ROLLBACK (ІСТОРІЯ ЗМІН ТА ВІДКАТ) */}
      {/* --------------------------------------------------------- */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-zinc-800 pb-3">
              <div>
                <h3 className="font-bold text-base text-gray-900 dark:text-white flex items-center">
                  <History className="w-4 h-4 text-rose-500 mr-2" />
                  Історія змін сумок
                </h3>
                <p className="text-[10px] text-gray-400">
                  Хронологія дій та можливість повернутися до попереднього стану
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {!changeHistory || changeHistory.length === 0 ? (
                <div className="p-6 text-center text-gray-400 text-xs">
                  Історія змін поки порожня
                </div>
              ) : (
                changeHistory.map((h) => {
                  const d = new Date(h.timestamp);
                  const timeFormatted = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
                  const dateFormatted = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });

                  return (
                    <div
                      key={h.id}
                      className="p-3 rounded-2xl bg-gray-50 dark:bg-zinc-800/70 border border-gray-100 dark:border-zinc-800 flex items-center justify-between"
                    >
                      <div className="flex-1 pr-2">
                        <div className="flex items-center space-x-1.5">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                            h.author === 'mom'
                              ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300'
                              : 'bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300'
                          }`}>
                            {h.author === 'mom' ? '🌸 Мама' : '🧔 Тато'}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {dateFormatted}, {timeFormatted}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 mt-1 line-clamp-2">
                          {h.description}
                        </p>
                      </div>

                      {h.snapshot && (
                        <button
                          type="button"
                          onClick={() => handleRevertToHistory(h)}
                          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-700 border border-gray-200 dark:border-zinc-600 text-rose-600 dark:text-rose-400 hover:bg-rose-50 text-[11px] font-bold shrink-0 active:scale-95 transition flex items-center space-x-1 shadow-xs"
                          title="Відновити стан сумок на цей момент"
                        >
                          <Undo2 className="w-3 h-3" />
                          <span>Відкат</span>
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowHistoryModal(false)}
              className="w-full py-2.5 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 font-bold text-xs"
            >
              Закрити
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* MODAL: RESET TO DEFAULT CONFIRMATION */}
      {/* --------------------------------------------------------- */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-5 w-full max-w-sm border border-gray-100 dark:border-zinc-800 shadow-2xl space-y-4 text-center">
            <RotateCcw className="w-10 h-10 text-rose-500 mx-auto" />
            <div>
              <h3 className="font-bold text-base text-gray-900 dark:text-white">
                Скинути список до стандарту?
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                Це відновить базовий набір сумок (M, L, S). Поточний стан буде збережено в історію перед скиданням.
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
                  const [allB, allI] = await Promise.all([db.hospitalBags.toArray(), db.bagItems.toArray()]);
                  if (isMom) p2pSyncManager.broadcastFullBagsSync(allB, allI);
                  setShowResetConfirm(false);
                  showToast('Сумки скинуто до стандартного шаблону');
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20 active:scale-95 transition"
              >
                Так, скинути
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default HospitalBagsView;
