// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type Deck, reorderSlides, type Slide } from "@jeswr/solid-slides";
import { Button, IconButton } from "@jeswr/suite-ui";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { SlideCanvas } from "./slide-canvas";

function SorterItem({
  slide,
  deck,
  selected,
  select,
  move,
}: {
  slide: Slide;
  deck: Deck;
  selected: boolean;
  select: () => void;
  move: (offset: number) => void;
}) {
  const sortable = useSortable({ id: slide.id });
  return (
    <li
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      data-selected={selected}
    >
      <div className="sld-sorter-item">
        <IconButton
          label={`Move slide ${slide.position + 1}`}
          {...sortable.attributes}
          {...sortable.listeners}
        >
          <GripVertical size={16} />
        </IconButton>
        <Button
          className="sld-slide-select"
          variant="ghost"
          aria-pressed={selected}
          onClick={select}
        >
          <span aria-hidden="true" className="sld-mini">
            <SlideCanvas slide={slide} deck={deck} thumbnail />
          </span>
          <span>
            {slide.position + 1}. {slide.title || "Untitled slide"}
            {slide.hidden ? " (hidden)" : ""}
          </span>
        </Button>
      </div>
      <div className="sld-sorter-move">
        <IconButton
          label={`Move slide ${slide.position + 1} up`}
          size="icon-sm"
          disabled={slide.position === 0}
          onClick={() => move(-1)}
        >
          <ArrowUp size={14} />
        </IconButton>
        <IconButton
          label={`Move slide ${slide.position + 1} down`}
          size="icon-sm"
          disabled={slide.position === deck.slides.length - 1}
          onClick={() => move(1)}
        >
          <ArrowDown size={14} />
        </IconButton>
      </div>
    </li>
  );
}
export function SlideSorter({
  deck,
  selected,
  onSelect,
  onChange,
}: {
  deck: Deck;
  selected: string | undefined;
  onSelect: (id: string) => void;
  onChange: (slides: Slide[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (!over || active.id === over.id) return;
        onChange(
          reorderSlides(
            deck.slides,
            deck.slides.findIndex((slide) => slide.id === active.id),
            deck.slides.findIndex((slide) => slide.id === over.id),
          ),
        );
      }}
    >
      <SortableContext
        items={deck.slides.map((slide) => slide.id)}
        strategy={verticalListSortingStrategy}
      >
        <ol className="sld-sorter" aria-label="Slide sorter">
          {deck.slides.map((slide, index) => (
            <SorterItem
              key={slide.id}
              slide={slide}
              deck={deck}
              selected={slide.id === selected}
              select={() => onSelect(slide.id)}
              move={(offset) => onChange(reorderSlides(deck.slides, index, index + offset))}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
