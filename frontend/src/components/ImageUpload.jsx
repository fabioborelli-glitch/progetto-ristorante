import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, X, Loader2 } from "lucide-react";
import { api, errMsg, imgUrl } from "@/lib/api";

export function ImageUpload({ value, onChange, label = "Foto", shape = "wide", testid = "image-upload" }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post("/t/upload", fd, { headers: { "Content-Type": "multipart/form-data" } });
      onChange(data.url);
      toast.success("Immagine caricata");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const box = shape === "square" ? "h-28 w-28" : "h-36 w-full";

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className={`relative ${box} rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 overflow-hidden grid place-items-center`} data-testid={testid}>
        {value ? (
          <>
            <img src={imgUrl(value)} alt="" className="absolute inset-0 w-full h-full object-cover" />
            <button type="button" onClick={() => onChange("")} className="absolute top-2 right-2 h-8 w-8 rounded-full bg-black/60 text-white grid place-items-center" data-testid={`${testid}-remove`}><X size={14} /></button>
          </>
        ) : (
          <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="flex flex-col items-center gap-1.5 text-gray-500 text-xs p-3" data-testid={`${testid}-pick`}>
            {busy ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
            {busy ? "Caricamento…" : "Scatta o scegli una foto"}
          </button>
        )}
        {value && !busy && (
          <button type="button" onClick={() => inputRef.current?.click()} className="absolute bottom-2 right-2 h-8 px-3 rounded-full bg-black/60 text-white text-xs" data-testid={`${testid}-change`}>Cambia</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} data-testid={`${testid}-input`} />
    </div>
  );
}
