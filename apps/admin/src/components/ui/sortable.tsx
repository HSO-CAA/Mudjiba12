import { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SortableRenderProps {
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  handle: {
    ref: (node: HTMLElement | null) => void;
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
  };
}

function SortableItem({ id, disabled, children }: { id: string; disabled?: boolean; children: (props: SortableRenderProps) => ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <>
      {children({
        setNodeRef,
        isDragging,
        style: {
          transform: CSS.Translate.toString(transform),
          transition,
          zIndex: isDragging ? 20 : undefined,
          position: 'relative',
        },
        handle: { ref: setActivatorNodeRef, attributes, listeners },
      })}
    </>
  );
}

const announcements = {
  onDragStart: () => 'بدأ السحب',
  onDragOver: () => 'تحريك',
  onDragEnd: () => 'تم تغيير الترتيب',
  onDragCancel: () => 'تم إلغاء السحب',
};

/** Drag-to-reorder list/grid. Only the explicit handle starts a drag, so touch scrolling keeps working. */
export function Sortable<T extends { id: string }>({
  items,
  onReorder,
  layout = 'grid',
  disabled = false,
  children,
}: {
  items: T[];
  onReorder: (next: T[]) => void;
  layout?: 'grid' | 'list';
  disabled?: boolean;
  children: (item: T, props: SortableRenderProps, index: number) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'اضغط مسافة حتى تمسك العنصر، واستخدم الأسهم للتحريك، ومسافة مرة ثانية للإفلات.' },
      }}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy} disabled={disabled}>
        {items.map((item, index) => (
          <SortableItem key={item.id} id={item.id} disabled={disabled}>
            {(props) => children(item, props, index)}
          </SortableItem>
        ))}
      </SortableContext>
    </DndContext>
  );
}

/** The grip button that starts a drag. */
export function DragHandle({
  handle,
  label = 'اسحب لتغيير الترتيب',
  className,
  disabled,
  ...rest
}: { handle: SortableRenderProps['handle']; label?: string; className?: string; disabled?: boolean } & HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      ref={handle.ref}
      {...handle.attributes}
      {...handle.listeners}
      {...rest}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-fg active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-30',
        className,
      )}
    >
      <GripVertical className="size-4" aria-hidden />
    </button>
  );
}
