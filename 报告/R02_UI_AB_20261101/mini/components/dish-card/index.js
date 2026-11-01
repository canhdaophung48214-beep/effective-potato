Component({properties:{item:{type:Object,value:null},compact:{type:Boolean,value:false},minimal:{type:Boolean,value:false}},methods:{open(){this.triggerEvent('open',{id:this.data.item.id})}}});
