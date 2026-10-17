import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Check } from "lucide-react";
import { api, errMsg, TABLE_STATUS } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useTenantSocket } from "@/hooks/useTenantSocket";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TableSheet } from "@/components/TableSheet";

const SIZE = 112;

export default function FloorPlan() {
  const { role } = useAuth();
  const canEdit = role === "owner" || role === "manager";
  const [rooms, setRooms] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [tables, setTables] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [roomOpen, setRoomOpen] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [newTable, setNewTable] = useState({ name: "", seats: 4, shape: "square" });
  const canvasRef = useRef(null);
  const drag = useRef(null);

  const loadTables = useCallback(() => {
    if (!roomId) return;
    api.get("/t/tables", { params: { room_id: roomId } }).then((r) => setTables(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [roomId]);

  useEffect(() => {
    api.get("/t/rooms").then((r) => {
      setRooms(r.data);
      if (r.data[0] && !roomId) setRoomId(r.data[0].id);
    });
  }, []);

  useEffect(() => {
    loadTables();
    if (editMode) return;
    const t = setInterval(loadTables, 30000);
    return () => clearInterval(t);
  }, [loadTables, editMode]);

  useTenantSocket((event) => {
    if ((event === "tables_changed" || event === "orders_changed") && !drag.current) loadTables();
  });

  const onPointerDown = (e, t) => {
    if (!editMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    drag.current = { id: t.id, offX: e.clientX - rect.left - t.x, offY: e.clientY - rect.top - t.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width - SIZE, e.clientX - rect.left - drag.current.offX));
    const y = Math.max(0, Math.min(rect.height - SIZE, e.clientY - rect.top - drag.current.offY));
    drag.current.moved = true;
    setTables((ts) => ts.map((t) => (t.id === drag.current.id ? { ...t, x, y } : t)));
  };
  const onPointerUp = async () => {
    if (!drag.current) return;
    const { id, moved } = drag.current;
    drag.current = null;
    if (!moved) return;
    const t = tables.find((x) => x.id === id);
    if (t) await api.put("/t/tables/positions", [{ id, x: t.x, y: t.y }]).catch((e) => toast.error(errMsg(e)));
  };

  const addTable = async (e) => {
    e.preventDefault();
    try {
      await api.post("/t/tables", { ...newTable, room_id: roomId, x: 40 + (tables.length % 5) * 150, y: 40 + Math.floor(tables.length / 5) * 150 });
      toast.success("Tavolo aggiunto");
      setAddOpen(false);
      setNewTable({ name: "", seats: 4, shape: "square" });
      loadTables();
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  const addRoom = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.post("/t/rooms", { name: newRoom });
      setRooms([...rooms, data]);
      setRoomId(data.id);
      setRoomOpen(false);
      setNewRoom("");
      toast.success("Sala creata");
    } catch (err) {
      toast.error(errMsg(err));
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col" data-testid="floorplan-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-extrabold tracking-tight">Sala</h1>
          <p className="text-gray-500 text-sm mt-1">Tocca un tavolo per gestirlo. {canEdit && "Attiva la modifica per spostare i tavoli."}</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button variant="outline" className="h-11" onClick={() => setRoomOpen(true)} data-testid="add-room-btn"><Plus size={16} className="mr-1" />Sala</Button>
              <Button variant="outline" className="h-11" onClick={() => setAddOpen(true)} disabled={!roomId} data-testid="add-table-btn"><Plus size={16} className="mr-1" />Tavolo</Button>
              <Button className={`h-11 ${editMode ? "bg-emerald-600 hover:bg-emerald-700" : "bg-gray-900 hover:bg-gray-800"}`} onClick={() => setEditMode(!editMode)} data-testid="toggle-edit-btn">
                {editMode ? <><Check size={16} className="mr-1" />Fine</> : <><Pencil size={16} className="mr-1" />Modifica piantina</>}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {rooms.map((r) => (
          <button key={r.id} onClick={() => setRoomId(r.id)} data-testid={`room-tab-${r.id}`}
            className={`px-4 h-10 rounded-full text-sm font-medium border transition-colors duration-200 ${roomId === r.id ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-200 hover:bg-gray-50"}`}>
            {r.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-4 text-xs text-gray-600">
          {Object.entries(TABLE_STATUS).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${v.color}`} />{v.label}</span>
          ))}
        </div>
      </div>

      <div ref={canvasRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        className={`floor-grid relative flex-1 min-h-[560px] rounded-xl border ${editMode ? "border-dashed border-gray-400" : "border-gray-200"} overflow-hidden`} data-testid="floor-canvas">
        {tables.map((t) => {
          const st = TABLE_STATUS[t.status] || TABLE_STATUS.libero;
          return (
            <div key={t.id} onPointerDown={(e) => onPointerDown(e, t)} onClick={() => !editMode && setSelected(t)}
              data-testid={`table-node-${t.name}`}
              style={{ left: t.x, top: t.y, width: SIZE, height: SIZE }}
              className={`table-node absolute ${drag.current?.id === t.id ? "dragging" : ""} ${editMode ? "cursor-move" : "cursor-pointer active:scale-95"} ${t.shape === "round" ? "rounded-full" : "rounded-2xl"} bg-white border-2 border-gray-200 flex flex-col items-center justify-center gap-1 ring-4 ring-offset-2 ring-offset-[#fafafa] ${st.ring}`}>
              <div className="font-display text-2xl font-extrabold">{t.name}</div>
              <div className="text-xs text-gray-500">{t.seats} posti</div>
              {t.open_orders > 0 && <div className="absolute -top-2 -right-2 h-7 min-w-7 px-2 rounded-full bg-[#E03131] text-white text-xs font-bold grid place-items-center">{t.open_orders}</div>}
              <div className={`absolute bottom-3 h-2 w-8 rounded-full ${st.color}`} />
            </div>
          );
        })}
        {tables.length === 0 && roomId && <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm">Nessun tavolo in questa sala. Aggiungine uno.</div>}
      </div>

      <TableSheet table={selected} onClose={() => setSelected(null)} onChanged={loadTables} canEdit={canEdit} rooms={rooms} />

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle className="font-display text-2xl">Nuovo tavolo</SheetTitle></SheetHeader>
          <form onSubmit={addTable} className="space-y-5 mt-6" data-testid="add-table-form">
            <div className="space-y-2"><Label>Nome</Label><Input className="h-11" value={newTable.name} onChange={(e) => setNewTable({ ...newTable, name: e.target.value })} required placeholder="es. T9" data-testid="table-name-input" /></div>
            <div className="space-y-2"><Label>Posti</Label><Input className="h-11" type="number" min={1} value={newTable.seats} onChange={(e) => setNewTable({ ...newTable, seats: +e.target.value })} data-testid="table-seats-input" /></div>
            <div className="space-y-2">
              <Label>Forma</Label>
              <div className="grid grid-cols-2 gap-2">
                {[["square", "Quadrato"], ["round", "Rotondo"]].map(([v, l]) => (
                  <button type="button" key={v} onClick={() => setNewTable({ ...newTable, shape: v })} data-testid={`shape-${v}`}
                    className={`h-11 rounded-lg border text-sm font-medium ${newTable.shape === v ? "bg-gray-900 text-white border-gray-900" : "border-gray-200"}`}>{l}</button>
                ))}
              </div>
            </div>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="table-submit-btn">Aggiungi</Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={roomOpen} onOpenChange={setRoomOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle className="font-display text-2xl">Nuova sala</SheetTitle></SheetHeader>
          <form onSubmit={addRoom} className="space-y-5 mt-6">
            <div className="space-y-2"><Label>Nome sala</Label><Input className="h-11" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} required placeholder="es. Terrazza" data-testid="room-name-input" /></div>
            <Button type="submit" className="w-full h-12 bg-[#E03131] hover:bg-[#c42727]" data-testid="room-submit-btn">Crea sala</Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
