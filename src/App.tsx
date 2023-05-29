import { ChangeEventHandler, useEffect, useMemo, useState } from "react";
import Color from "color";
import { Vec3, Mat4, Vec2 } from "gl-matrix/dist/esm";
import "./App.css";
import { downloadURI } from "./badcodes";

type Size = {
  width: number;
  height: number;
};

type Voxel = {
  color: string;
  position: Vec3;
};

const CUBE_VERTEX: Vec3[] = [
  Vec3.fromValues(-1, 1, 1),
  Vec3.fromValues(1, 1, 1),
  Vec3.fromValues(1, -1, 1),
  Vec3.fromValues(-1, -1, 1),
  Vec3.fromValues(-1, 1, -1),
  Vec3.fromValues(1, 1, -1),
  Vec3.fromValues(1, -1, -1),
  Vec3.fromValues(-1, -1, -1),
];

enum CubeFaceName {
  Front,
  Right,
  Left,
  Bottom,
  Back,
  Top,
}

const CUBE_FACES: number[][] = [
  [0, 1, 2, 3], // front
  [1, 5, 6, 2], // right
  [0, 4, 7, 3], // left
  [0, 4, 5, 1], // bottom
  [4, 5, 6, 7], // back
  [3, 7, 6, 2], // top
];

function renderPolygonPoints(mesh: Vec3[]) {
  let result = "";
  for (const vec3 of mesh) {
    result += `${result && " "}${vec3.x}, ${vec3.y}`;
  }
  return result;
}

function calculateNextVoxelPosition(position: Vec3, face: CubeFaceName): Vec3 {
  switch (face) {
    case CubeFaceName.Top:
      return Vec3.fromValues(position.x, position.y - 2, position.z);
    case CubeFaceName.Bottom:
      return Vec3.fromValues(position.x, position.y + 2, position.z);
    case CubeFaceName.Left:
      return Vec3.fromValues(position.x - 2, position.y, position.z);
    case CubeFaceName.Right:
      return Vec3.fromValues(position.x + 2, position.y, position.z);
    case CubeFaceName.Front:
      return Vec3.fromValues(position.x, position.y, position.z + 2);
    case CubeFaceName.Back:
      return Vec3.fromValues(position.x, position.y, position.z - 2);
  }
}

function* enumerate<T>(iterable: Iterable<T>): Iterable<readonly [number, T]> {
  let index = 0;
  for (const item of iterable) {
    yield [index, item] as const;
    index++;
  }
}

async function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      const result = event?.target?.result;
      if (result) {
        resolve(event.target.result as string);
      } else {
        reject();
      }
    };
    fileReader.readAsText(file);
  });
}

function clamp(number: number, min: number, max: number) {
  return Math.max(min, Math.min(max, number));
}

const INITIAL_VOXEL = { color: "#d5d5d5", position: Vec3.fromValues(0, 0, 0) };

const MAX_VOXELS = 100;
const WARN_AFTER = 60;

function App() {
  const [{ width, height }] = useState<Size>({ width: 512, height: 512 });
  const [mode, setMode] = useState<"draw" | "del">("draw");
  const [voxels, setVoxels] = useState<Voxel[]>([INITIAL_VOXEL]);
  const [azimuth, setAzimuth] = useState(110);
  const [elevation, setElevation] = useState(220);
  const [currentColor, setCurrentColor] = useState<string>(INITIAL_VOXEL.color);
  const [translate, setTranslate] = useState<Vec2>(Vec2.fromValues(0, 0));
  const [scale, setScale] = useState(20);
  const projection = useMemo(() => {
    const angleX = (azimuth / 180) * Math.PI;
    const angleY = (elevation / 180) * Math.PI;
    const mat4 = Mat4.create();
    Mat4.identity(mat4);
    Mat4.lookAt(
      mat4,
      Vec3.fromValues(Math.sin(angleX) * Math.cos(angleY), Math.sin(angleY), Math.cos(angleX) * Math.cos(angleY)),
      Vec3.fromValues(0, 0, 0),
      Vec3.fromValues(0, 1, 0)
    );
    mat4.scale(Vec3.fromValues(scale, scale, scale));
    return mat4;
  }, [azimuth, elevation, scale]);
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey) {
        setScale((scale) =>
          clamp(scale - (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX / 2 : event.deltaY / 2), 4, 100)
        );
      } else {
        const deltaX = event.deltaX / 4;
        const deltaY = event.deltaY / 4;
        setAzimuth((azimuth) => azimuth + deltaX);
        setElevation((elevation) => Math.min(226, Math.max(elevation - deltaY, 150)));
      }
    };
    document.body.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      document.body.removeEventListener("wheel", onWheel);
    };
  }, []);
  const computedMesh = useMemo(() => {
    const mesh: [face: Vec3[], voxel: Voxel, faceIndex: number][] = [];
    for (const voxel of voxels) {
      for (const [faceIndex, vertexIndexes] of enumerate(CUBE_FACES)) {
        const face: Vec3[] = [];
        for (const vertexIndex of vertexIndexes) {
          const vertex = CUBE_VERTEX[vertexIndex];
          const vec3 = Vec3.create();
          Vec3.add(vec3, vertex, voxel.position);
          Vec3.transformMat4(vec3, vec3, projection);
          face.push(vec3);
        }
        mesh.push([face, voxel, faceIndex]);
      }
    }
    mesh.sort(([facea], [faceb]) => {
      let suma = 0;
      let sumb = 0;
      for (const mesh of facea) {
        suma += mesh.z;
      }
      for (const mesh of faceb) {
        sumb += mesh.z;
      }
      return suma / facea.length - sumb / faceb.length;
    });
    return mesh;
  }, [voxels, projection]);
  const onImportFileInputChange: ChangeEventHandler<HTMLInputElement> = async (event) => {
    if (!event.target.files) {
      return;
    }
    const file = event.target.files[0];
    let parsedContent;
    try {
      parsedContent = JSON.parse(await readTextFile(file));
    } catch (e) {
      alert("Invalid file type.");
      return;
    }
    if (!Array.isArray(parsedContent)) {
      alert("JSON content should be array of voxel objects.");
      return;
    }
    for (const [index, voxelContent] of enumerate(parsedContent)) {
      if (!Object.hasOwn(voxelContent, "position")) {
        alert(`${index} does not have a position field.`);
        return;
      }
      if (!Object.hasOwn(voxelContent, "color")) {
        alert(`${index} does not have a color field.`);
        return;
      }
      if (voxelContent.position.length !== 3) {
        alert(`${index} position field should be array of three numbers represent x, y, z.`);
        return;
      }
    }
    setVoxels(
      parsedContent.map((voxelContent) => ({
        color: voxelContent.color,
        position: Vec3.fromValues(voxelContent.position[0], voxelContent.position[1], voxelContent.position[2]),
      }))
    );
  };
  const onDrawClick = () => {
    setMode("draw");
  };
  const onDeleteClick = () => {
    setMode("del");
  };
  return (
    <div className="container">
      <header>
        <div className="tools">
          <div className="color-input">
            <input type={"color"} value={currentColor} onChange={(e) => setCurrentColor(e.target.value)} />
          </div>
          <div className={"modes"}>
            <button onClick={onDrawClick} disabled={mode === "draw"}>
              Draw
            </button>
            <button onClick={onDeleteClick} disabled={mode === "del"}>
              Delete
            </button>
          </div>
        </div>
        <nav>
          <a
            download="Voxel.json"
            onClick={(event) => {
              event.preventDefault();
              var blob = new Blob(
                [
                  JSON.stringify(
                    voxels.map(({ color, position }) => ({ color, position: [position.x, position.y, position.z] }))
                  ),
                ],
                { type: "text/json" }
              );
              downloadURI(URL.createObjectURL(blob), "Voxel");
            }}
            className="link"
            href={"#export"}
          >
            Export
          </a>
          <label>
            <input onChange={onImportFileInputChange} type="file" style={{ display: "none" }} />
            <span className="link">Import</span>
          </label>
          <a
            onClick={(event) => {
              event.preventDefault();
              setVoxels([INITIAL_VOXEL]);
            }}
            className="link"
            href={"#reset"}
          >
            Reset
          </a>
        </nav>
      </header>
      <div className="canvas">
        <svg
          onPointerMove={(event) => {
            if (event.buttons === 1) {
              setTranslate(Vec2.fromValues(translate.x + event.movementX, translate.y + event.movementY));
            }
          }}
          width={"100%"}
          height={512}
          viewBox={`-${width / 2 + translate.x} -${height / 2 + translate.y} ${width} ${height}`}
        >
          {computedMesh.map(([face, voxel, faceIndex], index) => (
            <polygon
              onClick={() => {
                if (voxels.length >= MAX_VOXELS) {
                  return;
                }
                if (mode === "del") {
                  setVoxels(voxels.filter(({ position }) => !Vec3.equals(position, voxel.position)));
                } else {
                  setVoxels([
                    ...voxels,
                    {
                      position: calculateNextVoxelPosition(voxel.position, faceIndex),
                      color: currentColor,
                    },
                  ]);
                }
              }}
              key={index}
              stroke={Color(voxel.color).darken(0.2).hex()}
              strokeOpacity={1}
              fill={voxel.color}
              points={renderPolygonPoints(face)}
              strokeLinejoin="round"
            />
          ))}
        </svg>
      </div>
      {voxels.length > WARN_AFTER && <p className="warning">{MAX_VOXELS - voxels.length} bricks left.</p>}
    </div>
  );
}

export default App;
