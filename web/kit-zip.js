(() => {
  'use strict';
  const I = window.DesignI18n;
  const encoder = new TextEncoder();
  const crcTable = Array.from({length:256}, (_, index) => {
    let value=index;
    for (let bit=0;bit<8;bit++) value=(value&1) ? 0xedb88320^(value>>>1) : value>>>1;
    return value>>>0;
  });
  function crc32(bytes) {
    let crc=0xffffffff;
    for (const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8);
    return (crc^0xffffffff)>>>0;
  }
  // ZIP method 0 (stored), UTF-8 filenames. No dependency or server-side package.
  function bundle(files) {
    const parts=[], directory=[]; let offset=0, directorySize=0;
    if (!Array.isArray(files) || files.length>65535) throw I.error(I.msg("export.file.count"));
    for (const file of files) {
      if (typeof file.path!=='string' || typeof file.content!=='string' || !file.path || file.path.startsWith('/') || file.path.split('/').some(part=>part==='..') || file.path.includes('\\')) throw I.error(I.msg("export.file.name"));
      const name=encoder.encode(file.path), data=encoder.encode(file.content), crc=crc32(data);
      if (name.length>65535 || data.length>0xffffffff || offset>0xffffffff) throw I.error(I.msg("export.file.size"));
      const local=new Uint8Array(30+name.length), view=new DataView(local.buffer);
      view.setUint32(0,0x04034b50,true); view.setUint16(4,20,true); view.setUint16(6,0x0800,true);
      view.setUint16(12,33,true); view.setUint32(14,crc,true); view.setUint32(18,data.length,true); view.setUint32(22,data.length,true); view.setUint16(26,name.length,true); local.set(name,30);
      parts.push(local,data);
      const central=new Uint8Array(46+name.length), cv=new DataView(central.buffer);
      cv.setUint32(0,0x02014b50,true); cv.setUint16(4,20,true); cv.setUint16(6,20,true); cv.setUint16(8,0x0800,true); cv.setUint16(14,33,true); cv.setUint32(16,crc,true); cv.setUint32(20,data.length,true); cv.setUint32(24,data.length,true); cv.setUint16(28,name.length,true); cv.setUint32(42,offset,true); central.set(name,46);
      directory.push(central); directorySize+=central.length; offset+=local.length+data.length;
    }
    const end=new Uint8Array(22), ev=new DataView(end.buffer);
    ev.setUint32(0,0x06054b50,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,directorySize,true); ev.setUint32(16,offset,true);
    return new Blob([...parts,...directory,end],{type:'application/zip'});
  }
  window.DesignKitZip=Object.freeze({bundle});
})();
