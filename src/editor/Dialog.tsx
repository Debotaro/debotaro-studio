import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function Dialog({title,onClose,children,wide=false}:{title:string;onClose:()=>void;children:ReactNode;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=ref.current;const previous=document.activeElement as HTMLElement|null;element?.showModal();return()=>{element?.close();previous?.focus();};},[]);
  return <dialog ref={ref} className={wide?'dialog wide':'dialog'} onCancel={event=>{event.preventDefault();onClose();}} aria-labelledby="dialog-title"><div className="dialog-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={18}/></button></div>{children}</dialog>;
}
