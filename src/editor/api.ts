export async function api<T>(path:string,body?:unknown,method?:string,signal?:AbortSignal):Promise<T>{
  const response=await fetch(path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?{}:{'Content-Type':'application/json','X-Studio-Request':'1'},body:body===undefined?undefined:JSON.stringify(body),signal});
  const value=await response.json();if(!response.ok)throw new Error(value.error??'Request failed');return value as T;
}
export function download(filename:string,content:Blob){const url=URL.createObjectURL(content);const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
