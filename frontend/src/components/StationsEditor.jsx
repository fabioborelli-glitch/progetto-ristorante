import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const COLORS = ["#F59E0B", "#EF4444", "#3B82F6", "#10B981", "#8B5CF6", "#EC4899"];

export function StationsEditor({ stations: initial, onSaved }) {
  const { isSuper, refresh } = useAuth();
  const [list, setList] = useState(initial || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => setList(initial || []), [initial]);

  const update = (i, patch) => setList(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const remove = (i) => setList(list.filter((_, j) => j !== i));
  const add = () => setList([...list, { id: null, name: "", color: COLORS[list.length % COLORS.length] }]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch("/t/settings", { stations: list });
      onSaved?.(data);
      if (!isSuper) refresh();
      toast.success("Reparti salvati");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 md:p-8 space-y-5" data-testid="stations-section">
      <div>
        <h2 className="font-display text-lg font-bold">Reparti cucina (destinazioni comande)</h2>
        <p className="text-sm text-gray-500 mt-1">Ogni postazione KDS può filtrare per reparto. Assegna il reparto alle categorie o ai singoli piatti dal Menu. Il primo reparto è quello predefinito.</p>
      </div>
      <div className="space-y-2">
        {list.map((s, i) => (
          <div key={s.id || `new-${i}`} className="flex items-center gap-3" data-testid={`station-row-${i}`}>
            <GripVertical size={16} className="text-gray-300" />
            <div className="flex gap-1">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => update(i, { color: c })} style={{ background: c }} className={`h-6 w-6 rounded-full ${s.color === c ? "ring-2 ring-offset-2 ring-gray-900" : ""}`} data-testid={`station-color-${i}-${c.slice(1)}`} />
              ))}
            </div>
            <Input className="h-11 flex-1" value={s.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Nome reparto" data-testid={`station-name-${i}`} />
            <Button variant="ghost" size="icon" className="text-red-600" onClick={() => remove(i)} disabled={list.length <= 1} data-testid={`station-remove-${i}`}><Trash2 size={16} /></Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={add} data-testid="station-add-btn"><Plus size={16} className="mr-1" />Reparto</Button>
        <Button onClick={save} disabled={saving} className="bg-[#E03131] hover:bg-[#c42727]" data-testid="stations-save-btn">{saving ? "Salvataggio…" : "Salva reparti"}</Button>
      </div>
    </section>
  );
}
