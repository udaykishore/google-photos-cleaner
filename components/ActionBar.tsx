import { useState } from "react"
import Button from "@mui/material/Button"
import Dialog from "@mui/material/Dialog"
import DialogActions from "@mui/material/DialogActions"
import DialogContent from "@mui/material/DialogContent"
import DialogContentText from "@mui/material/DialogContentText"
import DialogTitle from "@mui/material/DialogTitle"
import Divider from "@mui/material/Divider"
import Paper from "@mui/material/Paper"
import Stack from "@mui/material/Stack"
import Typography from "@mui/material/Typography"
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded"
import CheckBoxOutlinedIcon from "@mui/icons-material/CheckBoxOutlined"
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank"
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded"
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded"

interface ActionBarProps {
  totalItems: number
  groupCount: number
  duplicateCount: number
  onSelectAll: () => void
  onDeselectAll: () => void
  onTrash: () => void
  onRescan: () => void
}

export function ActionBar({
  totalItems,
  groupCount,
  duplicateCount,
  onSelectAll,
  onDeselectAll,
  onTrash,
  onRescan,
}: ActionBarProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Paper
        elevation={1}
        sx={{
          position: "sticky",
          top: 64, // below the AppBar (64px standard Toolbar height)
          zIndex: 9,
          px: 3,
          py: 1,
          borderRadius: 0,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 1.5,
        }}>
        <Stack
          direction="row"
          alignItems="center"
          divider={<Divider orientation="vertical" flexItem />}
          spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {totalItems.toLocaleString()} items scanned
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {groupCount} duplicate group{groupCount !== 1 ? "s" : ""}
          </Typography>
        </Stack>

        {groupCount > 0 && (
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              size="small"
              startIcon={<RefreshRoundedIcon />}
              onClick={onRescan}>
              Re-scan
            </Button>
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
            <Button
              size="small"
              startIcon={<CheckBoxOutlinedIcon />}
              onClick={onSelectAll}>
              Select All
            </Button>
            <Button
              size="small"
              startIcon={<CheckBoxOutlineBlankIcon />}
              onClick={onDeselectAll}>
              Deselect All
            </Button>
            <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
            <Button
              variant="contained"
              color="error"
              size="small"
              startIcon={<DeleteOutlineRoundedIcon />}
              disabled={duplicateCount === 0}
              onClick={() => setConfirmOpen(true)}>
              Move {duplicateCount} Duplicate{duplicateCount !== 1 ? "s" : ""} to Trash
            </Button>
          </Stack>
        )}
      </Paper>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth>
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <WarningAmberRoundedIcon color="warning" />
          Confirm Move to Trash
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 1.5 }}>
            Are you sure you want to move{" "}
            <strong>
              {duplicateCount.toLocaleString()} duplicate{" "}
              {duplicateCount === 1 ? "item" : "items"}
            </strong>{" "}
            to Google Photos Trash?
          </DialogContentText>
          <DialogContentText
            variant="caption"
            sx={{ display: "block", color: "text.secondary" }}>
            Items can be restored from the Google Photos Trash within 60 days.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setConfirmOpen(false)
              onTrash()
            }}>
            Move to Trash
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
