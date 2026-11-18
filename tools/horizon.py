# Preview: what skyline does a rider see? (elevation angle of the terrain vs azimuth)
import numpy as np, cv2, json, sys
from scipy.ndimage import map_coordinates
G='/home/claude/game/'; c=np.load(G+'work/terrain_cache.npz'); Hn,Hf=c['Hn'],c['Hf']
CX,CZ=30.0,42.0; NEAR_R=1100.0; FAR_R=6400.0; NN=Hn.shape[0]; FN=Hf.shape[0]
sky=json.load(open(G+'work/sky.json'))
def hs(x,z):
    un=(x-CX)/NEAR_R*.5+.5; vn=(z-CZ)/NEAR_R*.5+.5
    ins=(un>0.002)&(un<0.998)&(vn>0.002)&(vn<0.998)
    out=map_coordinates(Hf,[((z-CZ)/FAR_R*.5+.5)*FN-.5,((x-CX)/FAR_R*.5+.5)*FN-.5],order=1,mode='nearest')
    out[ins]=map_coordinates(Hn,[vn[ins]*NN-.5,un[ins]*NN-.5],order=1,mode='nearest'); return out
ex,ez,eh=(float(sys.argv[1]),float(sys.argv[2]),2.2) if len(sys.argv)>2 else (25.0,0.0,2.2)
W,Hh=1440,300; az=np.radians(np.linspace(-180,180,W,endpoint=False))
ds=np.geomspace(20,6300,420)
img=np.zeros((Hh,W,3),np.float32); img[:]=(0.70,0.85,0.95)
best=np.full(W,-9.0); 
for d in ds[::-1]:   # far to near painter
    x=ex+np.cos(az)*d; z=ez+np.sin(az)*d; h=hs(x,z)
    ang=np.degrees(np.arctan2(h-eh,d))
    row=np.clip(((14-ang)/20*Hh).astype(int),0,Hh-1)   # 14deg top .. -6deg bottom
    T=np.exp(-d/2600.0)
    colr=np.array([0.16,0.24,0.2])*T+np.array([0.62,0.80,0.92])*(1-T)
    for i in range(W): img[row[i]:,i]=colr
cv2.line(img,(0,int(14/20*Hh)),(W,int(14/20*Hh)),(0,0,0),1)
sx=int((sky['sunAz']+180)/360*W); sy=int((14-sky['sunEl'])/20*Hh); cv2.circle(img,(sx,sy),6,(0,1,1),-1)
img=(np.clip(img,0,1)*255).astype(np.uint8)
for a in range(-180,180,30): cv2.putText(img,str(a),(int((a+180)/360*W),12),cv2.FONT_HERSHEY_SIMPLEX,0.4,(0,0,0),1)
cv2.imwrite('/home/claude/preview/horizon.jpg',img)
