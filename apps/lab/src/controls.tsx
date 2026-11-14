import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function FieldSelect({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; detail?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Select
        value={value}
        items={options}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) {
            onChange(next);
          }
        }}
      >
        <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent
          align="start"
          alignItemWithTrigger={false}
          className="lab-select-content"
          listLabel={label}
        >
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="lab-select-item">
              <span className="option-content">
                <span>{option.label}</span>
                {option.detail !== undefined && (
                  <span className="option-detail">{option.detail}</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
