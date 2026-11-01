'use strict';
function adaptOne(r){
 if(!r||!r.id||!r.sourceMenuPrice||!r.currentEffectivePrice)throw Error('INVALID_SOURCE');
 const s=r.sourceMenuPrice,c=r.currentEffectivePrice;
 if(typeof r.id!=='string'||typeof r.name!=='string'||!r.name.trim()||!r.legacyRecord||!r.legacyRecord.source||typeof r.legacyRecord.source.ref!=='string'||!r.legacyRecord.source.ref.trim()||!r.parentEvidence||!r.parentEvidence.stall)throw Error('INVALID_IDENTITY_OR_EVIDENCE');
 if(!Number.isFinite(s.amount)||s.amount<=0||typeof s.rawExpression!=='string'||!s.rawExpression)throw Error('INVALID_MENU_PRICE');
 if(c.validity!=='UNKNOWN'||c.amount!==null||s.unit!==null||s.sourceDate!==null)throw Error('UNEXPECTED_KNOWN_VALUE');
 return {id:r.id,name:r.name,historicalMenuPrice:{amount:s.amount,rawExpression:s.rawExpression,currency:s.currency,unit:null,sourceDate:null,sourceRef:s.sourceRef},currentEffectivePrice:{amount:null,validity:'UNKNOWN'},source:{...r.legacyRecord.source},parentEvidence:JSON.parse(JSON.stringify(r.parentEvidence)),display:{name:r.name,historicalPriceText:s.rawExpression,currentPriceText:'当前价格未核实',historyNotice:'历史菜单记录，仅供查阅，不用于购买或交易报价',sourceText:r.legacyRecord.source.detail+'；'+s.sourceRef,parentNotice:'档口名称暂定，门头及正式签发待核验'},permissions:{historicalDisplay:true,transactionQuote:false,formalImport:false}};
}
function adaptAll(rows){if(!Array.isArray(rows))throw Error('ARRAY_REQUIRED');const out=rows.map(adaptOne);if(new Set(out.map(r=>r.id)).size!==out.length)throw Error('DUPLICATE_ID');return out;}
function currentQuote(){throw Error('HISTORICAL_RECORD_NOT_QUOTABLE');}
module.exports={adaptOne,adaptAll,currentQuote};
